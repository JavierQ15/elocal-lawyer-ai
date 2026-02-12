import "dotenv/config";
import { Command } from "commander";
import pLimit from "p-limit";
import { QdrantClient, type Schemas } from "@qdrant/js-client-rest";
import { loadConfig } from "@boe/core/config";
import { createLogger } from "@boe/core/logger";
import { createMongoContext } from "@boe/core/db/mongo";
import type { ChunkSemanticoDoc } from "@boe/core/semantic/contracts";
import { createEmbedderFromEnv } from "@boe/core/embeddings";
import { toQdrantVigenciaHastaMs } from "@boe/core/qdrant";

interface IndexerOptions {
  batchSize: number;
  limit?: number;
  onlyNorma?: string[];
  embedConcurrency: number;
  cleanup: boolean;
  cleanupScrollBatchSize: number;
  cleanupDeleteBatchSize: number;
}

interface IndexerStats {
  seen: number;
  skippedSameHash: number;
  embedded: number;
  upserted: number;
  cleanupNormas: number;
  cleanupScanned: number;
  cleanupDeleted: number;
}

function parseIntOption(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid integer value: ${value}`);
  }
  return parsed;
}

function normalizeNormaIds(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  const normalized = values
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return Array.from(new Set(normalized));
}

function normalizeMongoEnvForCore(): void {
  if (process.env.MONGO_URI || !process.env.MONGO_URL) {
    return;
  }

  try {
    const url = new URL(process.env.MONGO_URL);
    const dbName = url.pathname.replace(/^\/+/, "").trim();
    if (dbName.length > 0 && !process.env.MONGO_DB) {
      process.env.MONGO_DB = dbName;
    }

    const uri = `${url.protocol}//${url.username ? `${url.username}:${url.password}@` : ""}${url.host}`;
    process.env.MONGO_URI = uri;
  } catch {
    process.env.MONGO_URI = process.env.MONGO_URL;
  }
}

function buildPayload(chunk: ChunkSemanticoDoc): Record<string, unknown> {
  return {
    chunk_id: chunk._id, // Guardar el _id original de MongoDB
    id_norma: chunk.metadata.id_norma,
    id_unidad: chunk.id_unidad,
    unidad_tipo: chunk.metadata.unidad_tipo,
    unidad_ref: chunk.metadata.unidad_ref,
    titulo: chunk.metadata.titulo,
    territorio_codigo: chunk.metadata.territorio.codigo,
    territorio_tipo: chunk.metadata.territorio.tipo,
    territorio_nombre: chunk.metadata.territorio.nombre,
    vigencia_desde: chunk.metadata.fecha_vigencia_desde?.getTime() ?? 0,
    vigencia_hasta: toQdrantVigenciaHastaMs(chunk.metadata.fecha_vigencia_hasta),
    url_html_consolidada: chunk.metadata.url_html_consolidada,
    url_eli: chunk.metadata.url_eli,
    tags: chunk.metadata.tags,
    text: chunk.texto,
    texto_hash: chunk.texto_hash,
    chunking_hash: chunk.chunking_hash,
  };
}

function payloadHasSameHashes(
  payload: Schemas["Payload"] | Record<string, unknown> | null | undefined,
  chunk: ChunkSemanticoDoc,
): boolean {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const row = payload as Record<string, unknown>;
  const expectedVigenciaDesde = chunk.metadata.fecha_vigencia_desde?.getTime() ?? 0;
  const expectedVigenciaHasta = toQdrantVigenciaHastaMs(chunk.metadata.fecha_vigencia_hasta);

  return (
    row.id_norma === chunk.metadata.id_norma &&
    row.id_unidad === chunk.id_unidad &&
    row.texto_hash === chunk.texto_hash &&
    row.chunking_hash === chunk.chunking_hash &&
    row.vigencia_desde === expectedVigenciaDesde &&
    row.vigencia_hasta === expectedVigenciaHasta
  );
}

/**
 * Convierte un SHA-256 hex (64 chars) a UUID v4 format (8-4-4-4-12)
 * Qdrant solo acepta UUIDs o unsigned integers como IDs
 */
function hashToUUID(hash: string): string {
  // Tomar los primeros 32 caracteres del hash y formatear como UUID
  const hex = hash.substring(0, 32);
  return `${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20, 32)}`;
}

function pointIdToString(id: unknown): string | null {
  if (typeof id === "string") {
    return id;
  }

  if (typeof id === "number") {
    return String(id);
  }

  if (id && typeof id === "object") {
    const uuid = (id as { uuid?: unknown }).uuid;
    if (typeof uuid === "string") {
      return uuid;
    }
  }

  return null;
}

function pointIdToExtendedPointId(id: unknown): Schemas["ExtendedPointId"] | null {
  if (typeof id === "string" || typeof id === "number") {
    return id;
  }

  const stringId = pointIdToString(id);
  if (typeof stringId === "string") {
    return stringId;
  }

  return null;
}

async function ensureCollection(
  client: QdrantClient,
  collection: string,
  vectorSize: number,
): Promise<void> {
  const exists = await client.collectionExists(collection);
  if (exists.exists) {
    return;
  }

  await client.createCollection(collection, {
    vectors: {
      size: vectorSize,
      distance: "Cosine",
    },
  });
}

async function main(): Promise<void> {
  const program = new Command();
  const defaultBatchSize = Number.parseInt(process.env.INDEXER_BATCH_SIZE ?? "32", 10);
  const defaultEmbedConcurrency = Number.parseInt(
    process.env.INDEXER_EMBED_CONCURRENCY ?? "4",
    10,
  );
  const defaultCleanupScrollBatchSize = Number.parseInt(
    process.env.INDEXER_CLEANUP_SCROLL_BATCH_SIZE ?? "512",
    10,
  );
  const defaultCleanupDeleteBatchSize = Number.parseInt(
    process.env.INDEXER_CLEANUP_DELETE_BATCH_SIZE ?? "256",
    10,
  );

  program
    .name("boe-indexer")
    .description("Indexa chunks_semanticos de Mongo en Qdrant")
    .option("--batch-size <number>", "Tamano de lote", parseIntOption, defaultBatchSize)
    .option("--limit <number>", "Limite maximo de chunks a procesar", parseIntOption)
    .option(
      "--embed-concurrency <number>",
      "Concurrencia de embeddings",
      parseIntOption,
      defaultEmbedConcurrency,
    )
    .option("--only-norma <ids...>", "Restringe a lista de id_norma")
    .option("--no-cleanup", "Desactiva cleanup de puntos huerfanos en Qdrant")
    .option(
      "--cleanup-scroll-batch-size <number>",
      "Tamano de pagina para scroll de cleanup",
      parseIntOption,
      defaultCleanupScrollBatchSize,
    )
    .option(
      "--cleanup-delete-batch-size <number>",
      "Tamano de lote para delete de cleanup",
      parseIntOption,
      defaultCleanupDeleteBatchSize,
    );

  program.parse(process.argv);
  const options = program.opts<IndexerOptions>();
  const onlyNorma = normalizeNormaIds(options.onlyNorma);

  if (options.batchSize <= 0) {
    throw new Error(`batch-size must be greater than 0 (got ${options.batchSize})`);
  }
  if (options.embedConcurrency <= 0) {
    throw new Error(`embed-concurrency must be greater than 0 (got ${options.embedConcurrency})`);
  }
  if (options.cleanupScrollBatchSize <= 0) {
    throw new Error(
      `cleanup-scroll-batch-size must be greater than 0 (got ${options.cleanupScrollBatchSize})`,
    );
  }
  if (options.cleanupDeleteBatchSize <= 0) {
    throw new Error(
      `cleanup-delete-batch-size must be greater than 0 (got ${options.cleanupDeleteBatchSize})`,
    );
  }

  normalizeMongoEnvForCore();
  const logger = createLogger(process.argv.includes("--verbose") || process.argv.includes("-v"));
  const config = loadConfig();
  const embedder = createEmbedderFromEnv();

  const qdrantUrl = process.env.QDRANT_URL ?? "http://127.0.0.1:6333";
  const qdrantApiKey = process.env.QDRANT_API_KEY?.trim() || undefined;
  const qdrantCollection = process.env.QDRANT_COLLECTION ?? "boe_chunks";
  const qdrantTimeout = Number.parseInt(process.env.QDRANT_HTTP_TIMEOUT_SEC ?? "10", 10);
  const qdrant = new QdrantClient({
    url: qdrantUrl,
    apiKey: qdrantApiKey,
    timeout: qdrantTimeout * 1000,
  });

  const mongo = await createMongoContext(config, logger);
  const chunksCollection = mongo.db.collection<ChunkSemanticoDoc>("chunks_semanticos");

  const stats: IndexerStats = {
    seen: 0,
    skippedSameHash: 0,
    embedded: 0,
    upserted: 0,
    cleanupNormas: 0,
    cleanupScanned: 0,
    cleanupDeleted: 0,
  };

  try {
    const filter: Record<string, unknown> = {};
    if (onlyNorma.length > 0) {
      filter.id_norma = { $in: onlyNorma };
    }

    const cursor = chunksCollection
      .find(filter)
      .sort({ id_norma: 1, id_unidad: 1, chunk_index: 1 });

    if (typeof options.limit === "number" && options.limit > 0) {
      cursor.limit(options.limit);
    }

    // Crear la colecciÃ³n antes de procesar chunks para evitar race conditions
    // Obtenemos el tamaÃ±o del vector del primer embedding
    let collectionExists = (await qdrant.collectionExists(qdrantCollection)).exists;

    if (!collectionExists) {
      const firstChunk = await chunksCollection.findOne(filter);
      if (firstChunk) {
        const testVector = await embedder.embed(firstChunk.texto);
        await ensureCollection(qdrant, qdrantCollection, testVector.length);
        logger.info({ collection: qdrantCollection, vectorSize: testVector.length }, "collection ready");
        collectionExists = true;
      }
    }

    const cleanupDisabledByLimit = typeof options.limit === "number" && options.limit > 0;
    const cleanupEnabled = options.cleanup && !cleanupDisabledByLimit;
    if (options.cleanup && cleanupDisabledByLimit) {
      logger.warn(
        { limit: options.limit },
        "cleanup skipped because --limit is active to avoid deleting valid points",
      );
    }

    const expectedPointIdsByNorma =
      cleanupEnabled && onlyNorma.length > 0
        ? new Map<string, Set<string>>(onlyNorma.map((idNorma) => [idNorma, new Set<string>()]))
        : null;

    let batch: ChunkSemanticoDoc[] = [];
    const limiter = pLimit(options.embedConcurrency);

    async function deletePointIdsInBatches(
      pointIds: Schemas["ExtendedPointId"][],
    ): Promise<void> {
      if (pointIds.length === 0) {
        return;
      }

      for (let index = 0; index < pointIds.length; index += options.cleanupDeleteBatchSize) {
        const idsBatch = pointIds.slice(index, index + options.cleanupDeleteBatchSize);
        await qdrant.delete(qdrantCollection, {
          wait: true,
          points: idsBatch,
        });
        stats.cleanupDeleted += idsBatch.length;
      }
    }

    async function cleanupNormaPoints(
      idNorma: string,
      expectedPointIds: Set<string>,
    ): Promise<void> {
      let offset: Schemas["ScrollRequest"]["offset"];
      const stalePointIds: Schemas["ExtendedPointId"][] = [];

      do {
        const page = await qdrant.scroll(qdrantCollection, {
          limit: options.cleanupScrollBatchSize,
          offset,
          with_payload: false,
          with_vector: false,
          filter: {
            must: [
              {
                key: "id_norma",
                match: { value: idNorma },
              },
            ],
          },
        });

        const points = page.points ?? [];
        stats.cleanupScanned += points.length;

        for (const point of points) {
          const rawPointId = (point as { id?: unknown }).id;
          const pointId = pointIdToString(rawPointId);
          const extendedPointId = pointIdToExtendedPointId(rawPointId);

          if (extendedPointId === null) {
            continue;
          }

          if (!pointId || !expectedPointIds.has(pointId)) {
            stalePointIds.push(extendedPointId);
          }
        }

        offset = page.next_page_offset;
      } while (offset !== undefined && offset !== null);

      if (stalePointIds.length > 0) {
        await deletePointIdsInBatches(stalePointIds);
        logger.warn(
          { id_norma: idNorma, deleted: stalePointIds.length },
          "cleanup removed stale qdrant points for norma",
        );
      }
    }

    async function cleanupWholeCollectionByChunkId(): Promise<void> {
      let offset: Schemas["ScrollRequest"]["offset"];

      do {
        const page = await qdrant.scroll(qdrantCollection, {
          limit: options.cleanupScrollBatchSize,
          offset,
          with_payload: ["chunk_id"],
          with_vector: false,
        });

        const points = page.points ?? [];
        stats.cleanupScanned += points.length;

        const pointToChunkId = new Map<Schemas["ExtendedPointId"], string | null>();
        const chunkIds: string[] = [];

        for (const point of points) {
          const rawPointId = (point as { id?: unknown }).id;
          const pointId = pointIdToExtendedPointId(rawPointId);
          if (pointId === null) {
            continue;
          }

          const payload = (point as { payload?: Schemas["Payload"] }).payload as
            | Record<string, unknown>
            | undefined;
          const chunkId = typeof payload?.chunk_id === "string" ? payload.chunk_id : null;

          pointToChunkId.set(pointId, chunkId);
          if (chunkId) {
            chunkIds.push(chunkId);
          }
        }

        const existingChunkIds = new Set<string>();
        if (chunkIds.length > 0) {
          const uniqueChunkIds = Array.from(new Set(chunkIds));
          const foundChunkIds = await chunksCollection.distinct("_id", {
            _id: { $in: uniqueChunkIds },
          });
          for (const foundChunkId of foundChunkIds) {
            if (typeof foundChunkId === "string") {
              existingChunkIds.add(foundChunkId);
            }
          }
        }

        const stalePointIds: Schemas["ExtendedPointId"][] = [];
        for (const [pointId, chunkId] of pointToChunkId) {
          if (!chunkId || !existingChunkIds.has(chunkId)) {
            stalePointIds.push(pointId);
          }
        }

        await deletePointIdsInBatches(stalePointIds);
        offset = page.next_page_offset;
      } while (offset !== undefined && offset !== null);
    }

    async function flushBatch(): Promise<void> {
      if (batch.length === 0) {
        return;
      }

      const batchWithIds = batch.map((chunk) => ({
        chunk,
        pointId: hashToUUID(chunk._id),
      }));

      if (expectedPointIdsByNorma) {
        for (const { chunk, pointId } of batchWithIds) {
          const idNorma = chunk.metadata.id_norma;
          const expectedIds = expectedPointIdsByNorma.get(idNorma);
          if (expectedIds) {
            expectedIds.add(pointId);
            continue;
          }

          expectedPointIdsByNorma.set(idNorma, new Set([pointId]));
        }
      }

      const existingPayloadByPointId = new Map<string, Schemas["Payload"] | null>();

      if (collectionExists) {
        try {
          const existing = await qdrant.retrieve(qdrantCollection, {
            ids: batchWithIds.map((item) => item.pointId),
            with_payload: true,
            with_vector: false,
          });

          for (const point of existing) {
            const pointId = pointIdToString((point as { id?: unknown }).id);
            if (!pointId) {
              continue;
            }

            existingPayloadByPointId.set(
              pointId,
              ((point as { payload?: Schemas["Payload"] }).payload ?? null) as Schemas["Payload"] | null,
            );
          }
        } catch (error) {
          logger.warn(
            { err: error instanceof Error ? error.message : String(error) },
            "batch retrieve failed, continuing with embeddings",
          );
        }
      }

      const points = (
        await Promise.all(
          batchWithIds.map(({ chunk, pointId }) =>
            limiter(async () => {
              const existingPayload = existingPayloadByPointId.get(pointId);
              if (payloadHasSameHashes(existingPayload, chunk)) {
                stats.skippedSameHash += 1;
                return null;
              }

              const vector = await embedder.embed(chunk.texto);
              stats.embedded += 1;

              return {
                id: pointId,
                vector,
                payload: buildPayload(chunk),
              };
            }),
          ),
        )
      ).filter(
        (point): point is { id: string; vector: number[]; payload: Record<string, unknown> } =>
          point !== null,
      );

      if (points.length > 0) {
        logger.info({ count: points.length, sampleId: points[0]?.id, vectorSize: points[0]?.vector.length }, "upserting batch");
        try {
          await qdrant.upsert(qdrantCollection, {
            wait: true,
            points,
          });
          stats.upserted += points.length;
        } catch (error) {
          logger.error({
            error: error instanceof Error ? error.message : String(error),
            sampleId: points[0]?.id,
            payloadSample: points[0]?.payload
          }, "upsert failed");
          throw error;
        }
      }

      batch = [];
    }

    for await (const chunk of cursor) {
      stats.seen += 1;
      batch.push(chunk);

      if (batch.length >= options.batchSize) {
        await flushBatch();
      }
    }

    await flushBatch();

    if (cleanupEnabled && collectionExists) {
      if (onlyNorma.length > 0) {
        for (const idNorma of onlyNorma) {
          stats.cleanupNormas += 1;
          await cleanupNormaPoints(
            idNorma,
            expectedPointIdsByNorma?.get(idNorma) ?? new Set<string>(),
          );
        }
      } else {
        await cleanupWholeCollectionByChunkId();
      }
    }

    logger.info({ stats, qdrantCollection }, "indexer completed");
  } finally {
    await mongo.client.close();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});


