import { FlowProducer, Queue, type JobsOptions } from "bullmq";
import IORedis from "ioredis";

export const QUEUE_NAMES = {
  sync: "q-sync",
  build: "q-build",
  index: "q-index",
  orchestrator: "q-orchestrator",
} as const;

export const JOB_NAMES = {
  syncNorma: "sync_norma",
  buildUnidadesNorma: "build_unidades_norma",
  buildChunksNorma: "build_chunks_norma",
  indexNorma: "index_norma",
  backfillSeed: "backfill_seed",
  resumeSeed: "resume_seed",
} as const;

export type PipelineStage = "sync" | "build_units" | "build_chunks" | "index";

export interface NormaStageJobData {
  id_norma: string;
  trigger: "backfill" | "resume";
}

export interface SeedJobData {
  from?: string;
  to?: string;
  limit?: number;
  batchSize: number;
  concurrencySync: number;
  concurrencyBuild: number;
  concurrencyIndex: number;
  query?: string;
}

export interface BackfillSeedJobData extends SeedJobData {
  forceResetStages: boolean;
}

export interface ResumeSeedJobData extends SeedJobData {}

export interface PipelineQueues {
  sync: Queue<NormaStageJobData>;
  build: Queue<NormaStageJobData>;
  index: Queue<NormaStageJobData>;
  orchestrator: Queue<BackfillSeedJobData | ResumeSeedJobData>;
}

export const DEFAULT_STAGE_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: {
    type: "exponential",
    delay: 1000,
  },
  removeOnComplete: true,
  removeOnFail: false,
};

export const ORCHESTRATOR_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 1000,
  },
  removeOnComplete: 20,
  removeOnFail: false,
};

function parseRedisDb(raw: string | undefined): number {
  if (!raw) {
    return 0;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid REDIS_DB value: ${raw}`);
  }

  return parsed;
}

export function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

export function createRedisConnection(): IORedis {
  const redisUrl = process.env.REDIS_URL;

  if (redisUrl && redisUrl.trim().length > 0) {
    return new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    });
  }

  return new IORedis({
    host: process.env.REDIS_HOST ?? "127.0.0.1",
    port: parsePositiveInt(process.env.REDIS_PORT, 6379),
    password: process.env.REDIS_PASSWORD?.trim() || undefined,
    db: parseRedisDb(process.env.REDIS_DB),
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
}

export function createPipelineQueues(connection: IORedis): PipelineQueues {
  return {
    sync: new Queue(QUEUE_NAMES.sync, {
      connection,
      defaultJobOptions: DEFAULT_STAGE_JOB_OPTIONS,
    }),
    build: new Queue(QUEUE_NAMES.build, {
      connection,
      defaultJobOptions: DEFAULT_STAGE_JOB_OPTIONS,
    }),
    index: new Queue(QUEUE_NAMES.index, {
      connection,
      defaultJobOptions: DEFAULT_STAGE_JOB_OPTIONS,
    }),
    orchestrator: new Queue(QUEUE_NAMES.orchestrator, {
      connection,
      defaultJobOptions: ORCHESTRATOR_JOB_OPTIONS,
    }),
  };
}

export function createFlowProducer(connection: IORedis): FlowProducer {
  return new FlowProducer({ connection });
}

export async function closePipelineQueues(queues: PipelineQueues): Promise<void> {
  await Promise.all([
    queues.sync.close(),
    queues.build.close(),
    queues.index.close(),
    queues.orchestrator.close(),
  ]);
}
