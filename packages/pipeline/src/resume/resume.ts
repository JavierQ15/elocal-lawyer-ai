import type { FlowProducer } from "bullmq";
import type { SyncStateDoc, SyncStageStatus } from "@boe/core/db/repositories";
import { enqueueNormaFlow, PIPELINE_STAGE_ORDER } from "../flows";
import { getPipelineQueueLoad, sleep } from "../queueMetrics";
import type { PipelineServices } from "../services";
import type { PipelineQueues, PipelineStage, ResumeSeedJobData } from "../queues";

export interface ResumeSeedResult {
  candidates: number;
  reseeded: number;
  enqueued: number;
  duplicateJobs: number;
  alreadyComplete: number;
}

function sanitizePositive(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

function normalizeStatus(raw: unknown): SyncStageStatus {
  if (raw === "pending" || raw === "running" || raw === "ok" || raw === "failed") {
    return raw;
  }

  if (raw === "error") {
    return "failed";
  }

  return "pending";
}

function readStageStatus(doc: SyncStateDoc, stage: PipelineStage): SyncStageStatus {
  const rawDoc = doc as unknown as Record<string, unknown>;
  if (!rawDoc.stages || typeof rawDoc.stages !== "object") {
    if (stage === "sync") {
      return normalizeStatus(rawDoc.status);
    }

    return "pending";
  }

  const stages = rawDoc.stages as Record<string, unknown>;
  const stageRow = stages[stage];

  if (!stageRow || typeof stageRow !== "object") {
    return "pending";
  }

  return normalizeStatus((stageRow as Record<string, unknown>).status);
}

function pickStartStage(doc: SyncStateDoc): PipelineStage | null {
  for (const stage of PIPELINE_STAGE_ORDER) {
    const status = readStageStatus(doc, stage);
    if (status !== "ok") {
      return stage;
    }
  }

  return null;
}

async function waitForQueueCapacity(
  services: PipelineServices,
  queues: Pick<PipelineQueues, "sync" | "build" | "index">,
  limits: { sync: number; build: number; index: number },
): Promise<void> {
  while (true) {
    const load = await getPipelineQueueLoad(queues);

    const hasCapacity =
      load.sync.total <= limits.sync &&
      load.build.total <= limits.build &&
      load.index.total <= limits.index;

    if (hasCapacity) {
      return;
    }

    services.logger.debug(
      {
        queueLoad: load,
        limits,
      },
      "resume seed waiting for queue capacity",
    );

    await sleep(1000);
  }
}

export async function runResumeSeed(
  services: PipelineServices,
  deps: {
    flowProducer: FlowProducer;
    queues: Pick<PipelineQueues, "sync" | "build" | "index">;
  },
  options: ResumeSeedJobData,
): Promise<ResumeSeedResult> {
  const syncStateCollection = services.mongo.db.collection<SyncStateDoc>("sync_state");
  const batchSize = sanitizePositive(options.batchSize, 200);

  const limits = {
    sync: sanitizePositive(options.concurrencySync, 4) * 4,
    build: sanitizePositive(options.concurrencyBuild, 4) * 4,
    index: sanitizePositive(options.concurrencyIndex, 4) * 4,
  };

  const query = {
    $or: [
      { status: { $in: ["pending", "failed", "running"] as const } },
      { "stages.index.status": { $ne: "ok" as const } },
    ],
  };

  const cursor = syncStateCollection
    .find(query)
    .sort({ last_seen_at: 1, id_norma: 1 });

  if (typeof options.limit === "number" && options.limit > 0) {
    cursor.limit(options.limit);
  }

  const candidates = await cursor.toArray();

  const result: ResumeSeedResult = {
    candidates: candidates.length,
    reseeded: 0,
    enqueued: 0,
    duplicateJobs: 0,
    alreadyComplete: 0,
  };

  services.logger.info(
    {
      candidates: candidates.length,
      batchSize,
      limits,
      limit: options.limit,
    },
    "resume seed started",
  );

  for (let start = 0; start < candidates.length; start += batchSize) {
    const batch = candidates.slice(start, start + batchSize);
    await waitForQueueCapacity(services, deps.queues, limits);

    for (const doc of batch) {
      const startStage = pickStartStage(doc);
      if (!startStage) {
        result.alreadyComplete += 1;
        continue;
      }

      const now = new Date();
      await services.mongo.repos.syncState.ensureNormaPending(doc.id_norma, now, false);

      result.reseeded += 1;

      const enqueued = await enqueueNormaFlow(deps.flowProducer, {
        idNorma: doc.id_norma,
        trigger: "resume",
        startFromStage: startStage,
      });

      if (enqueued.enqueued) {
        result.enqueued += 1;
      } else if (enqueued.reason === "duplicate") {
        result.duplicateJobs += 1;
      }
    }

    services.logger.info(
      {
        reseeded: result.reseeded,
        enqueued: result.enqueued,
        duplicateJobs: result.duplicateJobs,
        alreadyComplete: result.alreadyComplete,
      },
      "resume seed batch enqueued",
    );
  }

  services.logger.info({ result }, "resume seed completed");
  return result;
}
