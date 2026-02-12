import "dotenv/config";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { MongoClient, type Db } from "mongodb";
import { QdrantClient } from "@qdrant/js-client-rest";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { getUnidadesByIds, getUnidadById } from "@boe/core/db/unidades";
import type { SyncStateDoc } from "@boe/core/db/repositories";
import type { TerritorioCatalogDoc } from "@boe/core/semantic/contracts";
import type { Embedder } from "@boe/core/embeddings";
import { createEmbedderFromEnv } from "@boe/core/embeddings";
import { QdrantRagClient } from "@boe/core/qdrant";
import { OllamaChatClient } from "./llm/ollama";
import type { RagRouteDependencies, RagUnidadStore } from "./routes/rag";
import { registerRagRoutes } from "./routes/rag";

interface ApiConfig {
  host: string;
  port: number;
  redisUrl: string;
  requestTimeoutMs: number;
  rateLimitMax: number;
  rateLimitWindow: string;
  qdrantUrl: string;
  qdrantApiKey: string | null;
  qdrantCollection: string;
  qdrantSearchTimeoutSec: number;
  qdrantHttpTimeoutSec: number;
  corsOrigins: string[];
  mongoUri: string;
  mongoDb: string;
  ollamaBaseUrl: string;
  ragLlmModel: string;
  ragLlmTimeoutMs: number;
  ragLlmTemperature: number;
  answerTopUnidades: number;
  answerMaxUnidadChars: number;
}

interface BuildServerDependencies {
  embedder?: Embedder;
  routeNowProvider?: RagRouteDependencies["now"];
  config?: ApiConfig;
  unidadStore?: RagUnidadStore;
  territorioStore?: RagRouteDependencies["territorioStore"];
  answerModel?: RagRouteDependencies["answerModel"];
}

function parseIntegerEnv(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw) {
    return defaultValue;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`ENV ${name} must be an integer. Received: ${raw}`);
  }
  return parsed;
}

function parseFloatEnv(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw) {
    return defaultValue;
  }

  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`ENV ${name} must be a number. Received: ${raw}`);
  }
  return parsed;
}

function parseCsvEnv(name: string, defaultValue: string): string[] {
  const raw = process.env[name] ?? defaultValue;
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseDbNameFromUri(uri: string): string | null {
  try {
    const parsed = new URL(uri);
    const db = parsed.pathname.replace(/^\/+/, "").trim();
    return db.length > 0 ? db : null;
  } catch {
    return null;
  }
}

function loadMongoConfigFromEnv(): { mongoUri: string; mongoDb: string } {
  const mongoUri = process.env.MONGO_URI ?? process.env.MONGO_URL ?? "mongodb://localhost:27017";
  const dbFromUri = parseDbNameFromUri(mongoUri);
  const mongoDb = process.env.MONGO_DB ?? dbFromUri ?? "boe";
  return { mongoUri, mongoDb };
}

export function loadApiConfigFromEnv(): ApiConfig {
  const mongoConfig = loadMongoConfigFromEnv();

  return {
    host: process.env.HOST ?? "0.0.0.0",
    port: parseIntegerEnv("PORT", 3000),
    redisUrl: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
    requestTimeoutMs: parseIntegerEnv("REQUEST_TIMEOUT_MS", 30000),
    rateLimitMax: parseIntegerEnv("RATE_LIMIT_MAX", 120),
    rateLimitWindow: process.env.RATE_LIMIT_WINDOW ?? "1 minute",
    qdrantUrl: process.env.QDRANT_URL ?? "http://127.0.0.1:6333",
    qdrantApiKey: process.env.QDRANT_API_KEY ?? null,
    qdrantCollection: process.env.QDRANT_COLLECTION ?? "boe_chunks",
    qdrantSearchTimeoutSec: parseIntegerEnv("QDRANT_SEARCH_TIMEOUT_SEC", 3),
    qdrantHttpTimeoutSec: parseIntegerEnv("QDRANT_HTTP_TIMEOUT_SEC", 10),
    corsOrigins: parseCsvEnv(
      "CORS_ORIGINS",
      "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173",
    ),
    mongoUri: mongoConfig.mongoUri,
    mongoDb: mongoConfig.mongoDb,
    ollamaBaseUrl: process.env.RAG_LLM_BASE_URL ?? process.env.OLLAMA_URL ?? "http://127.0.0.1:11434",
    ragLlmModel: process.env.RAG_LLM_MODEL ?? "qwen2.5:7b-instruct",
    ragLlmTimeoutMs: parseIntegerEnv("RAG_LLM_TIMEOUT_MS", 90000),
    ragLlmTemperature: parseFloatEnv("RAG_LLM_TEMPERATURE", 0.1),
    answerTopUnidades: parseIntegerEnv("RAG_ANSWER_TOP_UNIDADES", 5),
    answerMaxUnidadChars: parseIntegerEnv("RAG_ANSWER_MAX_UNIDAD_CHARS", 6000),
  };
}

function buildQdrantClient(config: ApiConfig): QdrantRagClient {
  const client = new QdrantClient({
    url: config.qdrantUrl,
    apiKey: config.qdrantApiKey ?? undefined,
    // Qdrant JS client timeout is milliseconds.
    timeout: config.qdrantHttpTimeoutSec * 1000,
  });

  return new QdrantRagClient(client, {
    collectionName: config.qdrantCollection,
    timeoutSec: config.qdrantSearchTimeoutSec,
  });
}

interface PipelineQueues {
  sync: Queue;
  build: Queue;
  index: Queue;
  orchestrator: Queue;
}

interface QueueSnapshot {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
  prioritized: number;
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

export async function buildServer(
  dependencies: BuildServerDependencies = {},
): Promise<FastifyInstance> {
  const config = dependencies.config ?? loadApiConfigFromEnv();
  const app = Fastify({
    logger: true,
    requestTimeout: config.requestTimeoutMs,
  });

  await app.register(rateLimit, {
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindow,
  });
  await app.register(cors, {
    origin: config.corsOrigins.includes("*") ? true : config.corsOrigins,
    methods: ["GET", "POST", "OPTIONS"],
  });

  const embedder = dependencies.embedder ?? createEmbedderFromEnv();
  const qdrant = buildQdrantClient(config);

  let mongoClient: MongoClient | null = null;
  let mongoDb: Db | null = null;
  let unidadStore = dependencies.unidadStore;
  let territorioStore = dependencies.territorioStore;
  if (!unidadStore) {
    mongoClient = new MongoClient(config.mongoUri, { appName: "boe-rag-api" });
    await mongoClient.connect();
    mongoDb = mongoClient.db(config.mongoDb);

    unidadStore = {
      getUnidadesByIds: (ids) => getUnidadesByIds(mongoDb as Db, ids),
      getUnidadById: (idUnidad) => getUnidadById(mongoDb as Db, idUnidad),
    };

    if (!territorioStore) {
      const territoriosCollection = mongoDb.collection<TerritorioCatalogDoc>("territorios");
      territorioStore = {
        listAutonomicos: async () => {
          const docs = await territoriosCollection
            .find(
              {
                tipo: "AUTONOMICO",
                codigo: { $regex: "^CCAA:" },
              },
              {
                projection: {
                  _id: 0,
                  codigo: 1,
                  nombre: 1,
                },
              },
            )
            .sort({
              nombre: 1,
              codigo: 1,
            })
            .toArray();

          return docs
            .map((doc) => ({
              codigo: (doc.codigo ?? "").trim(),
              nombre: (doc.nombre ?? "").trim() || (doc.codigo ?? "").trim(),
            }))
            .filter((doc) => doc.codigo.length > 0);
        },
      };
    }

    app.addHook("onClose", async () => {
      if (mongoClient) {
        await mongoClient.close();
      }
    });
  }

  let pipelineRedis: IORedis | null = null;
  let pipelineQueues: PipelineQueues | null = null;

  try {
    pipelineRedis = new IORedis(config.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    });

    pipelineQueues = {
      sync: new Queue("q-sync", { connection: pipelineRedis }),
      build: new Queue("q-build", { connection: pipelineRedis }),
      index: new Queue("q-index", { connection: pipelineRedis }),
      orchestrator: new Queue("q-orchestrator", { connection: pipelineRedis }),
    };

    app.addHook("onClose", async () => {
      if (pipelineQueues) {
        await Promise.all([
          pipelineQueues.sync.close(),
          pipelineQueues.build.close(),
          pipelineQueues.index.close(),
          pipelineQueues.orchestrator.close(),
        ]);
      }

      if (pipelineRedis) {
        await pipelineRedis.quit();
      }
    });
  } catch (error) {
    app.log.warn(
      {
        err: error instanceof Error ? error.message : String(error),
      },
      "pipeline stats Redis integration disabled",
    );
    pipelineRedis = null;
    pipelineQueues = null;
  }

  const answerModel =
    dependencies.answerModel ??
    new OllamaChatClient({
      baseUrl: config.ollamaBaseUrl,
      model: config.ragLlmModel,
      timeoutMs: config.ragLlmTimeoutMs,
      temperature: config.ragLlmTemperature,
    });

  await registerRagRoutes(app, {
    embedder,
    qdrant,
    unidadStore,
    territorioStore,
    answerModel,
    answerTopUnidades: config.answerTopUnidades,
    answerMaxUnidadChars: config.answerMaxUnidadChars,
    now: dependencies.routeNowProvider,
  });

  app.get<{ Querystring: { windowMinutes?: string } }>(
    "/pipeline/stats",
    async (request, reply) => {
      if (!mongoDb) {
        return reply.status(503).send({
          error: "pipeline stats unavailable without direct Mongo connection",
        });
      }

      const rawWindow = request.query?.windowMinutes;
      const parsedWindow = rawWindow ? Number.parseInt(rawWindow, 10) : Number.NaN;
      const windowMinutes =
        Number.isFinite(parsedWindow) && parsedWindow > 0 ? parsedWindow : 60;
      const windowStart = new Date(Date.now() - windowMinutes * 60_000);
      const syncStateCollection = mongoDb.collection<SyncStateDoc>("sync_state");

      const [
        pending,
        running,
        ok,
        failed,
        syncDone,
        buildUnitsDone,
        buildChunksDone,
        indexDone,
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
      ]);

      const perMinute = (value: number): number => Number((value / windowMinutes).toFixed(3));

      let queueSnapshots: Record<string, QueueSnapshot> | null = null;
      let queueError: string | null = null;

      if (pipelineQueues) {
        try {
          const [syncQueue, buildQueue, indexQueue, orchestratorQueue] = await Promise.all([
            readQueueSnapshot(pipelineQueues.sync),
            readQueueSnapshot(pipelineQueues.build),
            readQueueSnapshot(pipelineQueues.index),
            readQueueSnapshot(pipelineQueues.orchestrator),
          ]);

          queueSnapshots = {
            sync: syncQueue,
            build: buildQueue,
            index: indexQueue,
            orchestrator: orchestratorQueue,
          };
        } catch (error) {
          queueError = error instanceof Error ? error.message : String(error);
        }
      }

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
        queues: queueSnapshots,
        queue_error: queueError,
      };
    },
  );

  app.get("/health", async () => ({ status: "ok" }));
  app.get("/healthz", async () => ({ status: "ok" }));

  return app;
}

export async function startServer(): Promise<void> {
  const config = loadApiConfigFromEnv();
  const app = await buildServer({ config });
  const address = await app.listen({
    port: config.port,
    host: config.host,
  });

  app.log.info({ address }, "rag api started");
}

if (require.main === module) {
  startServer().catch((error) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
