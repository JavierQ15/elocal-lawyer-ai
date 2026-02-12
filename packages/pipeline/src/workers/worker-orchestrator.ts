import "dotenv/config";
import { Worker } from "bullmq";
import {
  JOB_NAMES,
  QUEUE_NAMES,
  createFlowProducer,
  createPipelineQueues,
  createRedisConnection,
  parsePositiveInt,
  type BackfillSeedJobData,
  type ResumeSeedJobData,
} from "../queues";
import { runBackfillSeed } from "../seed/backfill";
import { runResumeSeed } from "../resume/resume";
import { closePipelineServices, createPipelineServices } from "../services";

function normalizeBaseSeedOptions<T extends BackfillSeedJobData | ResumeSeedJobData>(data: T): T {
  const fallbackBatchSize = parsePositiveInt(process.env.PIPELINE_SEED_BATCH_SIZE, 200);
  const fallbackSync = parsePositiveInt(process.env.PIPELINE_CONCURRENCY_SYNC, 4);
  const fallbackBuild = parsePositiveInt(process.env.PIPELINE_CONCURRENCY_BUILD, 4);
  const fallbackIndex = parsePositiveInt(process.env.PIPELINE_CONCURRENCY_INDEX, 2);

  return {
    ...data,
    batchSize: parsePositiveInt(String(data.batchSize ?? ""), fallbackBatchSize),
    concurrencySync: parsePositiveInt(String(data.concurrencySync ?? ""), fallbackSync),
    concurrencyBuild: parsePositiveInt(String(data.concurrencyBuild ?? ""), fallbackBuild),
    concurrencyIndex: parsePositiveInt(String(data.concurrencyIndex ?? ""), fallbackIndex),
  };
}

function normalizeBackfillPayload(data: BackfillSeedJobData): BackfillSeedJobData {
  const normalized = normalizeBaseSeedOptions(data);
  return {
    ...normalized,
    forceResetStages: data.forceResetStages !== false,
  };
}

function normalizeResumePayload(data: ResumeSeedJobData): ResumeSeedJobData {
  return normalizeBaseSeedOptions(data);
}

async function main(): Promise<void> {
  const verbose = process.argv.includes("--verbose") || process.argv.includes("-v");
  const services = await createPipelineServices({ verbose });
  const connection = createRedisConnection();
  const queues = createPipelineQueues(connection);
  const flowProducer = createFlowProducer(connection);

  const concurrency = parsePositiveInt(process.env.PIPELINE_CONCURRENCY_ORCHESTRATOR, 1);

  const worker = new Worker<BackfillSeedJobData | ResumeSeedJobData>(
    QUEUE_NAMES.orchestrator,
    async (job) => {
      if (job.name === JOB_NAMES.backfillSeed) {
        const data = normalizeBackfillPayload(job.data as BackfillSeedJobData);
        return runBackfillSeed(
          services,
          {
            flowProducer,
            queues,
          },
          data,
        );
      }

      if (job.name === JOB_NAMES.resumeSeed) {
        const data = normalizeResumePayload(job.data as ResumeSeedJobData);
        return runResumeSeed(
          services,
          {
            flowProducer,
            queues,
          },
          data,
        );
      }

      throw new Error(`Unexpected job name in ${QUEUE_NAMES.orchestrator}: ${job.name}`);
    },
    {
      connection,
      concurrency,
    },
  );

  worker.on("completed", (job, result) => {
    services.logger.info(
      {
        queue: QUEUE_NAMES.orchestrator,
        jobId: job.id,
        name: job.name,
        result,
      },
      "orchestrator job completed",
    );
  });

  worker.on("failed", (job, error) => {
    services.logger.error(
      {
        queue: QUEUE_NAMES.orchestrator,
        jobId: job?.id,
        name: job?.name,
        err: error?.message,
      },
      "orchestrator job failed",
    );
  });

  services.logger.info(
    {
      queue: QUEUE_NAMES.orchestrator,
      concurrency,
    },
    "worker-orchestrator started",
  );

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    services.logger.info({ signal }, "worker-orchestrator shutting down");

    await worker.close();
    await flowProducer.close();
    await Promise.all([
      queues.sync.close(),
      queues.build.close(),
      queues.index.close(),
      queues.orchestrator.close(),
    ]);
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
