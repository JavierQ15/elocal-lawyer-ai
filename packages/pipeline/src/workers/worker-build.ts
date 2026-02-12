import "dotenv/config";
import { Worker } from "bullmq";
import {
  JOB_NAMES,
  QUEUE_NAMES,
  createRedisConnection,
  parsePositiveInt,
  type NormaStageJobData,
} from "../queues";
import { closePipelineServices, createPipelineServices } from "../services";
import { runWorkspaceNodeScript } from "../subprocess";
import type { SyncStageName } from "@boe/core/db/repositories";

function resolveBuildCommand(jobName: string, idNorma: string): {
  stage: SyncStageName;
  args: string[];
} {
  if (jobName === JOB_NAMES.buildUnidadesNorma) {
    return {
      stage: "build_units",
      args: [
        "build-unidades",
        "--only-norma",
        idNorma,
        "--concurrency",
        "1",
        "--fail-on-errors",
      ],
    };
  }

  if (jobName === JOB_NAMES.buildChunksNorma) {
    return {
      stage: "build_chunks",
      args: [
        "build-chunks",
        "--only-norma",
        idNorma,
        "--concurrency",
        "1",
        "--fail-on-errors",
      ],
    };
  }

  throw new Error(`Unexpected job name in ${QUEUE_NAMES.build}: ${jobName}`);
}

async function main(): Promise<void> {
  const verbose = process.argv.includes("--verbose") || process.argv.includes("-v");
  const services = await createPipelineServices({ verbose });
  const connection = createRedisConnection();

  const concurrency = parsePositiveInt(process.env.PIPELINE_CONCURRENCY_BUILD, 4);
  const rateLimitMax = parsePositiveInt(process.env.PIPELINE_BUILD_RATE_LIMIT_MAX, 0);
  const rateLimitDuration = parsePositiveInt(
    process.env.PIPELINE_BUILD_RATE_LIMIT_DURATION_MS,
    1000,
  );

  const worker = new Worker<NormaStageJobData>(
    QUEUE_NAMES.build,
    async (job) => {
      const idNorma = job.data?.id_norma;
      if (!idNorma) {
        throw new Error(`${job.name} job missing id_norma`);
      }

      const command = resolveBuildCommand(job.name, idNorma);
      const state = await services.mongo.repos.syncState.findByNorma(idNorma);
      const stageState = state?.stages[command.stage];
      if (stageState?.status === "ok") {
        return {
          id_norma: idNorma,
          stage: command.stage,
          skipped: true,
          reason: "already_processed",
        };
      }

      await services.mongo.repos.syncState.markStageStart(
        idNorma,
        command.stage,
        new Date(),
        false,
      );

      try {
        await runWorkspaceNodeScript("packages/builder/dist/index.js", command.args);

        await services.mongo.repos.syncState.markStageSuccess(
          idNorma,
          command.stage,
          new Date(),
          false,
          { completeNorma: false },
        );

        return {
          id_norma: idNorma,
          stage: command.stage,
          skipped: false,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await services.mongo.repos.syncState.markStageFailure(
          idNorma,
          command.stage,
          message,
          new Date(),
          false,
        );

        throw error;
      }
    },
    {
      connection,
      concurrency,
      limiter: rateLimitMax > 0 ? { max: rateLimitMax, duration: rateLimitDuration } : undefined,
    },
  );

  worker.on("completed", (job) => {
    services.logger.info(
      {
        queue: QUEUE_NAMES.build,
        jobId: job.id,
        name: job.name,
        id_norma: job.data?.id_norma,
      },
      "build job completed",
    );
  });

  worker.on("failed", (job, error) => {
    services.logger.error(
      {
        queue: QUEUE_NAMES.build,
        jobId: job?.id,
        name: job?.name,
        id_norma: job?.data?.id_norma,
        err: error?.message,
      },
      "build job failed",
    );
  });

  services.logger.info(
    {
      queue: QUEUE_NAMES.build,
      concurrency,
      rateLimitMax,
      rateLimitDuration,
    },
    "worker-build started",
  );

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    services.logger.info({ signal }, "worker-build shutting down");

    await worker.close();
    await connection.quit();
    await closePipelineServices(services);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
