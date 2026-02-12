import type { Queue } from "bullmq";

export interface QueueInFlightCounts {
  waiting: number;
  active: number;
  delayed: number;
  prioritized: number;
  total: number;
}

export interface PipelineQueueLoad {
  sync: QueueInFlightCounts;
  build: QueueInFlightCounts;
  index: QueueInFlightCounts;
}

function toInFlightCounts(row: Record<string, number>): QueueInFlightCounts {
  const waiting = row.waiting ?? 0;
  const active = row.active ?? 0;
  const delayed = row.delayed ?? 0;
  const prioritized = row.prioritized ?? 0;

  return {
    waiting,
    active,
    delayed,
    prioritized,
    total: waiting + active + delayed + prioritized,
  };
}

export async function getQueueInFlight(queue: Queue): Promise<QueueInFlightCounts> {
  const row = await queue.getJobCounts("waiting", "active", "delayed", "prioritized");
  return toInFlightCounts(row);
}

export async function getPipelineQueueLoad(queues: {
  sync: Queue;
  build: Queue;
  index: Queue;
}): Promise<PipelineQueueLoad> {
  const [sync, build, index] = await Promise.all([
    getQueueInFlight(queues.sync),
    getQueueInFlight(queues.build),
    getQueueInFlight(queues.index),
  ]);

  return {
    sync,
    build,
    index,
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
