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

async function main(): Promise<void> {
  const verbose = process.argv.includes("--verbose") || process.argv.includes("-v");
  const services = await createPipelineServices({ verbose });
  const connection = createRedisConnection();

  const concurrency = parsePositiveInt(process.env.PIPELINE_CONCURRENCY_SYNC, 4);
  const rateLimitMax = parsePositiveInt(process.env.PIPELINE_SYNC_RATE_LIMIT_MAX, 0);
  const rateLimitDuration = parsePositiveInt(
    process.env.PIPELINE_SYNC_RATE_LIMIT_DURATION_MS,
    1000,
  );

  const worker = new Worker<NormaStageJobData>(
    QUEUE_NAMES.sync,
    async (job) => {
      if (job.name !== JOB_NAMES.syncNorma) {
        throw new Error(`Unexpected job name in ${QUEUE_NAMES.sync}: ${job.name}`);
      }

      const idNorma = job.data?.id_norma;
      if (!idNorma) {
        throw new Error("sync_norma job missing id_norma");
      }

      const state = await services.mongo.repos.syncState.findByNorma(idNorma);
      if (state?.stages.sync.status === "ok") {
        return {
          id_norma: idNorma,
          skipped: true,
          reason: "already_synced",
        };
      }

      await services.mongo.repos.syncState.markStageStart(
        idNorma,
        "sync",
        new Date(),
        false,
      );

      try {
        await runWorkspaceNodeScript("packages/ingestor/dist/index.js", [
          "sync",
          "--norma-id",
          idNorma,
          "--concurrency",
          "1",
          "--fail-on-errors",
        ]);

        await services.mongo.repos.syncState.markStageSuccess(
          idNorma,
          "sync",
          new Date(),
          false,
          { completeNorma: false },
        );

        return {
          id_norma: idNorma,
          skipped: false,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await services.mongo.repos.syncState.markStageFailure(
          idNorma,
          "sync",
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
        queue: QUEUE_NAMES.sync,
        jobId: job.id,
        name: job.name,
        id_norma: job.data?.id_norma,
      },
      "sync job completed",
    );
  });

  worker.on("failed", (job, error) => {
    services.logger.error(
      {
        queue: QUEUE_NAMES.sync,
        jobId: job?.id,
        name: job?.name,
        id_norma: job?.data?.id_norma,
        err: error?.message,
      },
      "sync job failed",
    );
  });

  services.logger.info(
    {
      queue: QUEUE_NAMES.sync,
      concurrency,
      rateLimitMax,
      rateLimitDuration,
    },
    "worker-sync started",
  );

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    services.logger.info({ signal }, "worker-sync shutting down");

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
