import type { FlowProducer } from "bullmq";
import { normalizeCliDateToBoe } from "@boe/core/parsers/dates";
import { parseNormasResponse } from "@boe/core/parsers/parseNormas";
import type { NormaNormalized } from "@boe/core/types";
import { enqueueNormaFlow } from "../flows";
import { getPipelineQueueLoad, sleep } from "../queueMetrics";
import type { PipelineServices } from "../services";
import type { BackfillSeedJobData, PipelineQueues } from "../queues";

export interface BackfillSeedResult {
  discovered: number;
  seeded: number;
  enqueued: number;
  duplicateJobs: number;
}

function sanitizePositive(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

function maybeDisableTerritory(
  norma: NormaNormalized,
  normalizeTerritory: boolean,
): NormaNormalized {
  if (normalizeTerritory) {
    return norma;
  }

  return {
    ...norma,
    ambito_codigo: null,
    departamento_codigo: null,
    territorio: {
      tipo: "ESTATAL",
      codigo: "ES:STATE",
      nombre: "España (Estatal)",
    },
  };
}

async function discoverNormaIds(
  services: PipelineServices,
  options: BackfillSeedJobData,
): Promise<string[]> {
  const from = normalizeCliDateToBoe(options.from);
  const to = normalizeCliDateToBoe(options.to);

  const discoverBatchSize = sanitizePositive(options.batchSize, 200);
  const requestedLimit =
    typeof options.limit === "number" && options.limit > 0 ? options.limit : -1;

  let offset = 0;
  let remaining = requestedLimit;
  const ids: string[] = [];

  while (true) {
    const effectiveLimit =
      requestedLimit === -1 ? discoverBatchSize : Math.min(discoverBatchSize, remaining);

    if (effectiveLimit <= 0) {
      break;
    }

    const payload = await services.boeClient.listNormas({
      from,
      to,
      offset,
      limit: effectiveLimit,
      query: options.query,
    });

    const parsed = parseNormasResponse(payload);
    if (parsed.length === 0) {
      break;
    }

    const now = new Date();
    for (const norma of parsed) {
      const normaForUpsert = maybeDisableTerritory(
        norma,
        services.config.normalizeTerritory,
      );
      await services.mongo.repos.normas.upsertFromDiscover(normaForUpsert, now, false);
      ids.push(norma.id_norma);

      if (requestedLimit !== -1) {
        remaining -= 1;
        if (remaining <= 0) {
          break;
        }
      }
    }

    offset += parsed.length;

    if (parsed.length < effectiveLimit) {
      break;
    }

    if (requestedLimit !== -1 && remaining <= 0) {
      break;
    }
  }

  return [...new Set(ids)];
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
      "backfill seed waiting for queue capacity",
    );

    await sleep(1000);
  }
}

export async function runBackfillSeed(
  services: PipelineServices,
  deps: {
    flowProducer: FlowProducer;
    queues: Pick<PipelineQueues, "sync" | "build" | "index">;
  },
  options: BackfillSeedJobData,
): Promise<BackfillSeedResult> {
  const discoveredNormaIds = await discoverNormaIds(services, options);
  const batchSize = sanitizePositive(options.batchSize, 200);

  const limits = {
    sync: sanitizePositive(options.concurrencySync, 4) * 4,
    build: sanitizePositive(options.concurrencyBuild, 4) * 4,
    index: sanitizePositive(options.concurrencyIndex, 4) * 4,
  };

  const result: BackfillSeedResult = {
    discovered: discoveredNormaIds.length,
    seeded: 0,
    enqueued: 0,
    duplicateJobs: 0,
  };

  services.logger.info(
    {
      discovered: discoveredNormaIds.length,
      batchSize,
      limits,
      forceResetStages: options.forceResetStages,
      from: options.from,
      to: options.to,
      limit: options.limit,
    },
    "backfill seed started",
  );

  for (let start = 0; start < discoveredNormaIds.length; start += batchSize) {
    const batch = discoveredNormaIds.slice(start, start + batchSize);
    const now = new Date();

    await services.mongo.repos.syncState.ensureNormasPending(batch, now, false, {
      forceResetStages: options.forceResetStages,
    });

    await waitForQueueCapacity(services, deps.queues, limits);

    for (const idNorma of batch) {
      result.seeded += 1;

      const enqueued = await enqueueNormaFlow(deps.flowProducer, {
        idNorma,
        trigger: "backfill",
        startFromStage: "sync",
      });

      if (enqueued.enqueued) {
        result.enqueued += 1;
      } else if (enqueued.reason === "duplicate") {
        result.duplicateJobs += 1;
      }
    }

    services.logger.info(
      {
        seeded: result.seeded,
        enqueued: result.enqueued,
        duplicateJobs: result.duplicateJobs,
        total: discoveredNormaIds.length,
      },
      "backfill seed batch enqueued",
    );
  }

  services.logger.info({ result }, "backfill seed completed");
  return result;
}
