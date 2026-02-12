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

  const concurrency = parsePositiveInt(process.env.PIPELINE_CONCURRENCY_INDEX, 2);
  const rateLimitMax = parsePositiveInt(process.env.PIPELINE_INDEX_RATE_LIMIT_MAX, 0);
  const rateLimitDuration = parsePositiveInt(
    process.env.PIPELINE_INDEX_RATE_LIMIT_DURATION_MS,
    1000,
  );

  const defaultBatchSize = parsePositiveInt(process.env.INDEXER_BATCH_SIZE, 32);
  const defaultEmbedConcurrency = parsePositiveInt(
    process.env.INDEXER_EMBED_CONCURRENCY,
    4,
  );

  const worker = new Worker<NormaStageJobData>(
    QUEUE_NAMES.index,
    async (job) => {
      if (job.name !== JOB_NAMES.indexNorma) {
        throw new Error(`Unexpected job name in ${QUEUE_NAMES.index}: ${job.name}`);
      }

      const idNorma = job.data?.id_norma;
      if (!idNorma) {
        throw new Error("index_norma job missing id_norma");
      }

      const state = await services.mongo.repos.syncState.findByNorma(idNorma);
      if (state?.stages.index.status === "ok") {
        return {
          id_norma: idNorma,
          skipped: true,
          reason: "already_indexed",
        };
      }

      await services.mongo.repos.syncState.markStageStart(
        idNorma,
        "index",
        new Date(),
        false,
      );

      try {
        await runWorkspaceNodeScript("packages/indexer/dist/index.js", [
          "--only-norma",
          idNorma,
          "--batch-size",
          String(defaultBatchSize),
          "--embed-concurrency",
          String(defaultEmbedConcurrency),
        ]);

        await services.mongo.repos.syncState.markStageSuccess(
          idNorma,
          "index",
          new Date(),
          false,
          { completeNorma: true },
        );

        return {
          id_norma: idNorma,
          skipped: false,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await services.mongo.repos.syncState.markStageFailure(
          idNorma,
          "index",
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
        queue: QUEUE_NAMES.index,
        jobId: job.id,
        name: job.name,
        id_norma: job.data?.id_norma,
      },
      "index job completed",
    );
  });

  worker.on("failed", (job, error) => {
    services.logger.error(
      {
        queue: QUEUE_NAMES.index,
        jobId: job?.id,
        name: job?.name,
        id_norma: job?.data?.id_norma,
        err: error?.message,
      },
      "index job failed",
    );
  });

  services.logger.info(
    {
      queue: QUEUE_NAMES.index,
      concurrency,
      defaultBatchSize,
      defaultEmbedConcurrency,
      rateLimitMax,
      rateLimitDuration,
    },
    "worker-index started",
  );

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    services.logger.info({ signal }, "worker-index shutting down");

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
