import "dotenv/config";
import { Command } from "commander";
import { QueueEvents } from "bullmq";
import {
  JOB_NAMES,
  QUEUE_NAMES,
  closePipelineQueues,
  createFlowProducer,
  createPipelineQueues,
  createRedisConnection,
  parsePositiveInt,
  type BackfillSeedJobData,
  type ResumeSeedJobData,
} from "./queues";
import { collectPipelineStats } from "./pipelineStats";
import { runResumeSeed } from "./resume/resume";
import { runBackfillSeed } from "./seed/backfill";
import { closePipelineServices, createPipelineServices } from "./services";

function parseOptionalInt(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid integer value: ${value}`);
  }

  return parsed;
}

interface SeedCliOptions {
  from?: string;
  to?: string;
  limit?: number;
  batchSize?: number;
  concurrencySync?: number;
  concurrencyBuild?: number;
  concurrencyIndex?: number;
  query?: string;
  forceResetStages?: boolean;
  wait?: boolean;
  waitTimeoutMs?: number;
  inline?: boolean;
}

function toBackfillPayload(options: SeedCliOptions): BackfillSeedJobData {
  return {
    from: options.from,
    to: options.to,
    limit: options.limit,
    query: options.query,
    batchSize: options.batchSize ?? parsePositiveInt(process.env.PIPELINE_SEED_BATCH_SIZE, 200),
    concurrencySync:
      options.concurrencySync ?? parsePositiveInt(process.env.PIPELINE_CONCURRENCY_SYNC, 4),
    concurrencyBuild:
      options.concurrencyBuild ?? parsePositiveInt(process.env.PIPELINE_CONCURRENCY_BUILD, 4),
    concurrencyIndex:
      options.concurrencyIndex ?? parsePositiveInt(process.env.PIPELINE_CONCURRENCY_INDEX, 2),
    forceResetStages: options.forceResetStages !== false,
  };
}

function toResumePayload(options: SeedCliOptions): ResumeSeedJobData {
  return {
    limit: options.limit,
    batchSize: options.batchSize ?? parsePositiveInt(process.env.PIPELINE_SEED_BATCH_SIZE, 200),
    concurrencySync:
      options.concurrencySync ?? parsePositiveInt(process.env.PIPELINE_CONCURRENCY_SYNC, 4),
    concurrencyBuild:
      options.concurrencyBuild ?? parsePositiveInt(process.env.PIPELINE_CONCURRENCY_BUILD, 4),
    concurrencyIndex:
      options.concurrencyIndex ?? parsePositiveInt(process.env.PIPELINE_CONCURRENCY_INDEX, 2),
  };
}

async function enqueueSeedJob(args: {
  name: typeof JOB_NAMES.backfillSeed | typeof JOB_NAMES.resumeSeed;
  payload: BackfillSeedJobData | ResumeSeedJobData;
  wait: boolean;
  waitTimeoutMs?: number;
}): Promise<void> {
  const connection = createRedisConnection();
  const queues = createPipelineQueues(connection);

  try {
    const job = await queues.orchestrator.add(args.name, args.payload);
    console.log(`Enqueued ${args.name} job: ${job.id}`);

    if (!args.wait) {
      return;
    }

    const eventsConnection = createRedisConnection();
    const queueEvents = new QueueEvents(QUEUE_NAMES.orchestrator, {
      connection: eventsConnection,
    });

    try {
      await queueEvents.waitUntilReady();
      const result = await job.waitUntilFinished(
        queueEvents,
        args.waitTimeoutMs && args.waitTimeoutMs > 0 ? args.waitTimeoutMs : undefined,
      );
      console.log(JSON.stringify(result, null, 2));
    } finally {
      await queueEvents.close();
      await eventsConnection.quit();
    }
  } finally {
    await closePipelineQueues(queues);
    await connection.quit();
  }
}

async function runBackfillInline(payload: BackfillSeedJobData, verbose: boolean): Promise<void> {
  const services = await createPipelineServices({ verbose });
  const connection = createRedisConnection();
  const queues = createPipelineQueues(connection);
  const flowProducer = createFlowProducer(connection);

  try {
    const result = await runBackfillSeed(
      services,
      {
        flowProducer,
        queues,
      },
      payload,
    );

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await flowProducer.close();
    await closePipelineQueues(queues);
    await connection.quit();
    await closePipelineServices(services);
  }
}

async function runResumeInline(payload: ResumeSeedJobData, verbose: boolean): Promise<void> {
  const services = await createPipelineServices({ verbose });
  const connection = createRedisConnection();
  const queues = createPipelineQueues(connection);
  const flowProducer = createFlowProducer(connection);

  try {
    const result = await runResumeSeed(
      services,
      {
        flowProducer,
        queues,
      },
      payload,
    );

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await flowProducer.close();
    await closePipelineQueues(queues);
    await connection.quit();
    await closePipelineServices(services);
  }
}

async function runStats(windowMinutes: number, verbose: boolean): Promise<void> {
  const services = await createPipelineServices({ verbose });
  const connection = createRedisConnection();
  const queues = createPipelineQueues(connection);

  try {
    const snapshot = await collectPipelineStats({
      db: services.mongo.db,
      queues,
      windowMinutes,
    });

    console.log(JSON.stringify(snapshot, null, 2));
  } finally {
    await closePipelineQueues(queues);
    await connection.quit();
    await closePipelineServices(services);
  }
}

async function runStop(): Promise<void> {
  const connection = createRedisConnection();
  const queues = createPipelineQueues(connection);

  try {
    await Promise.all([
      queues.sync.pause(),
      queues.build.pause(),
      queues.index.pause(),
      queues.orchestrator.pause(),
    ]);

    console.log("Paused q-sync, q-build, q-index, q-orchestrator");
  } finally {
    await closePipelineQueues(queues);
    await connection.quit();
  }
}

async function main(): Promise<void> {
  const verbose = process.argv.includes("--verbose") || process.argv.includes("-v");
  const program = new Command();

  program
    .name("boe-pipeline")
    .description("Orquestador BullMQ para backfill/resume BOE")
    .option("-v, --verbose", "Activa logs debug");

  program
    .command("backfill")
    .description("Descubre normas y encola flow sync->build->index")
    .option("--from <date>", "Fecha inicio (YYYY-MM-DD) sobre fecha_actualizacion")
    .option("--to <date>", "Fecha fin (YYYY-MM-DD) sobre fecha_actualizacion")
    .option("--limit <number>", "Limite de normas", parseOptionalInt)
    .option("--batch-size <number>, --batchSize <number>", "Batch de seed", parseOptionalInt)
    .option("--concurrency-sync <number>", "Capacidad de cola sync", parseOptionalInt)
    .option("--concurrency-build <number>", "Capacidad de cola build", parseOptionalInt)
    .option("--concurrency-index <number>", "Capacidad de cola index", parseOptionalInt)
    .option("--query <json>", "Parametro query del API BOE")
    .option("--no-force-reset-stages", "No reinicia stages antes de encolar")
    .option("--wait", "Espera a que finalice el job de orquestador")
    .option("--wait-timeout-ms <number>", "Timeout de espera", parseOptionalInt)
    .option("--inline", "Ejecuta seed directo sin worker-orchestrator")
    .action(async (options: SeedCliOptions) => {
      const payload = toBackfillPayload(options);

      if (options.inline) {
        await runBackfillInline(payload, verbose);
        return;
      }

      await enqueueSeedJob({
        name: JOB_NAMES.backfillSeed,
        payload,
        wait: options.wait ?? false,
        waitTimeoutMs: options.waitTimeoutMs,
      });
    });

  program
    .command("resume")
    .description("Reencola normas pendientes/fallidas usando sync_state")
    .option("--limit <number>", "Limite de normas", parseOptionalInt)
    .option("--batch-size <number>, --batchSize <number>", "Batch de seed", parseOptionalInt)
    .option("--concurrency-sync <number>", "Capacidad de cola sync", parseOptionalInt)
    .option("--concurrency-build <number>", "Capacidad de cola build", parseOptionalInt)
    .option("--concurrency-index <number>", "Capacidad de cola index", parseOptionalInt)
    .option("--wait", "Espera a que finalice el job de orquestador")
    .option("--wait-timeout-ms <number>", "Timeout de espera", parseOptionalInt)
    .option("--inline", "Ejecuta seed directo sin worker-orchestrator")
    .action(async (options: SeedCliOptions) => {
      const payload = toResumePayload(options);

      if (options.inline) {
        await runResumeInline(payload, verbose);
        return;
      }

      await enqueueSeedJob({
        name: JOB_NAMES.resumeSeed,
        payload,
        wait: options.wait ?? false,
        waitTimeoutMs: options.waitTimeoutMs,
      });
    });

  program
    .command("stop")
    .description("Pausa todas las colas del pipeline")
    .action(async () => {
      await runStop();
    });

  program
    .command("stats")
    .description("Resumen de estado por cola y sync_state")
    .option("--window-minutes <number>", "Ventana para throughput", parseOptionalInt, 60)
    .action(async (options: { windowMinutes: number }) => {
      await runStats(options.windowMinutes, verbose);
    });

  await program.parseAsync(process.argv);
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
