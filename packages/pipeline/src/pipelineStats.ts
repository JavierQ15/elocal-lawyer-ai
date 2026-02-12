import type { Queue } from "bullmq";
import type { Db } from "mongodb";
import type { SyncStateDoc } from "@boe/core/db/repositories";

export interface QueueSnapshot {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
  prioritized: number;
}

export interface StageThroughput {
  completed_last_window: number;
  per_minute: number;
}

export interface PipelineStatsSnapshot {
  generated_at: string;
  window_minutes: number;
  status: {
    pending: number;
    running: number;
    ok: number;
    failed: number;
  };
  stage_throughput: {
    sync: StageThroughput;
    build_units: StageThroughput;
    build_chunks: StageThroughput;
    index: StageThroughput;
  };
  queues: {
    sync: QueueSnapshot;
    build: QueueSnapshot;
    index: QueueSnapshot;
    orchestrator: QueueSnapshot;
  };
}

async function readQueueSnapshot(queue: Queue): Promise<QueueSnapshot> {
  const counts = await queue.getJobCounts(
    "waiting",
    "active",
    "completed",
    "failed",
    "delayed",
    "paused",
    "prioritized",
  );

  return {
    waiting: counts.waiting ?? 0,
    active: counts.active ?? 0,
    completed: counts.completed ?? 0,
    failed: counts.failed ?? 0,
    delayed: counts.delayed ?? 0,
    paused: counts.paused ?? 0,
    prioritized: counts.prioritized ?? 0,
  };
}

export async function collectPipelineStats(args: {
  db: Db;
  queues: {
    sync: Queue;
    build: Queue;
    index: Queue;
    orchestrator: Queue;
  };
  windowMinutes: number;
}): Promise<PipelineStatsSnapshot> {
  const syncStateCollection = args.db.collection<SyncStateDoc>("sync_state");
  const windowMinutes = Math.max(1, Math.floor(args.windowMinutes));
  const windowStart = new Date(Date.now() - windowMinutes * 60_000);

  const [
    pending,
    running,
    ok,
    failed,
    syncDone,
    buildUnitsDone,
    buildChunksDone,
    indexDone,
    syncQueue,
    buildQueue,
    indexQueue,
    orchestratorQueue,
  ] = await Promise.all([
    syncStateCollection.countDocuments({ status: "pending" }),
    syncStateCollection.countDocuments({ status: "running" }),
    syncStateCollection.countDocuments({ status: "ok" }),
    syncStateCollection.countDocuments({ status: "failed" }),
    syncStateCollection.countDocuments({
      "stages.sync.status": "ok",
      "stages.sync.last_finished_at": { $gte: windowStart },
    }),
    syncStateCollection.countDocuments({
      "stages.build_units.status": "ok",
      "stages.build_units.last_finished_at": { $gte: windowStart },
    }),
    syncStateCollection.countDocuments({
      "stages.build_chunks.status": "ok",
      "stages.build_chunks.last_finished_at": { $gte: windowStart },
    }),
    syncStateCollection.countDocuments({
      "stages.index.status": "ok",
      "stages.index.last_finished_at": { $gte: windowStart },
    }),
    readQueueSnapshot(args.queues.sync),
    readQueueSnapshot(args.queues.build),
    readQueueSnapshot(args.queues.index),
    readQueueSnapshot(args.queues.orchestrator),
  ]);

  const perMinute = (value: number): number => {
    return Number((value / windowMinutes).toFixed(3));
  };

  return {
    generated_at: new Date().toISOString(),
    window_minutes: windowMinutes,
    status: {
      pending,
      running,
      ok,
      failed,
    },
    stage_throughput: {
      sync: {
        completed_last_window: syncDone,
        per_minute: perMinute(syncDone),
      },
      build_units: {
        completed_last_window: buildUnitsDone,
        per_minute: perMinute(buildUnitsDone),
      },
      build_chunks: {
        completed_last_window: buildChunksDone,
        per_minute: perMinute(buildChunksDone),
      },
      index: {
        completed_last_window: indexDone,
        per_minute: perMinute(indexDone),
      },
    },
    queues: {
      sync: syncQueue,
      build: buildQueue,
      index: indexQueue,
      orchestrator: orchestratorQueue,
    },
  };
}
