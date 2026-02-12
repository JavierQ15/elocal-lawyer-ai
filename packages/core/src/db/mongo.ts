import { MongoClient, type Collection, type Db } from "mongodb";
import type { Logger } from "pino";
import type { AppConfig } from "../config";
import {
  BloquesRepository,
  ChunksRepository,
  IndicesRepository,
  NormasRepository,
  SyncStateRepository,
  VersionesRepository,
  type BloqueDoc,
  type ChunkDoc,
  type IndiceDoc,
  type NormaDoc,
  type SyncStateDoc,
  type VersionDoc,
} from "./repositories";
import type {
  ChunkSemanticoDoc,
  TerritorioCatalogDoc,
  UnidadDoc,
} from "../semantic/contracts";

export interface Repositories {
  normas: NormasRepository;
  bloques: BloquesRepository;
  versiones: VersionesRepository;
  chunks: ChunksRepository;
  indices: IndicesRepository;
  syncState: SyncStateRepository;
}

export interface MongoContext {
  client: MongoClient;
  db: Db;
  repos: Repositories;
}

function hasSameIndexKey(
  existing: Record<string, unknown> | undefined,
  desired: Record<string, number>,
): boolean {
  if (!existing) {
    return false;
  }

  const existingKeys = Object.keys(existing);
  const desiredKeys = Object.keys(desired);

  if (existingKeys.length !== desiredKeys.length) {
    return false;
  }

  for (let index = 0; index < desiredKeys.length; index += 1) {
    const field = desiredKeys[index];
    if (existingKeys[index] !== field) {
      return false;
    }

    if (existing[field] !== desired[field]) {
      return false;
    }
  }

  return true;
}

async function dropIndexIfDefinitionChanged(
  collection: Collection<SyncStateDoc>,
  indexName: string,
  desiredKey: Record<string, number>,
  logger: Logger,
): Promise<void> {
  let indexes: Array<{ name?: string; key?: Record<string, unknown> }>;
  try {
    indexes = await collection.indexes();
  } catch (error) {
    const mongoError = error as { code?: number; codeName?: string; message?: string };
    const namespaceMissing =
      mongoError.code === 26 ||
      mongoError.codeName === "NamespaceNotFound" ||
      (typeof mongoError.message === "string" &&
        mongoError.message.includes("ns does not exist"));

    if (namespaceMissing) {
      return;
    }

    throw error;
  }

  const existing = indexes.find((index) => index.name === indexName);
  if (!existing) {
    return;
  }

  if (hasSameIndexKey(existing.key as Record<string, unknown> | undefined, desiredKey)) {
    return;
  }

  await collection.dropIndex(indexName);
  logger.warn(
    {
      indexName,
      previousKey: existing.key,
      desiredKey,
    },
    "Dropped stale sync_state index definition",
  );
}

export async function ensureIndexes(db: Db, logger: Logger): Promise<void> {
  const normasCollection = db.collection<NormaDoc>("normas");
  const bloquesCollection = db.collection<BloqueDoc>("bloques");
  const versionesCollection = db.collection<VersionDoc>("versiones");
  const chunksCollection = db.collection<ChunkDoc>("chunks");
  const unidadesCollection = db.collection<UnidadDoc>("unidades");
  const chunksSemanticosCollection = db.collection<ChunkSemanticoDoc>("chunks_semanticos");
  const territoriosCollection = db.collection<TerritorioCatalogDoc>("territorios");
  const indicesCollection = db.collection<IndiceDoc>("indices");
  const syncStateCollection = db.collection<SyncStateDoc>("sync_state");

  await dropIndexIfDefinitionChanged(
    syncStateCollection,
    "idx_sync_state_status",
    { status: 1, last_seen_at: -1 },
    logger,
  );

  await Promise.all([
    normasCollection.createIndex({ id_norma: 1 }, { unique: true, name: "uq_normas_id_norma" }),
    normasCollection.createIndex(
      { fecha_actualizacion: -1 },
      { name: "idx_normas_fecha_actualizacion" },
    ),
    normasCollection.createIndex(
      { "territorio.codigo": 1 },
      { name: "idx_normas_territorio_codigo" },
    ),
    normasCollection.createIndex({ ambito_codigo: 1 }, { name: "idx_normas_ambito_codigo" }),

    bloquesCollection.createIndex(
      { id_norma: 1, id_bloque: 1 },
      { unique: true, name: "uq_bloques_norma_bloque" },
    ),
    bloquesCollection.createIndex(
      { id_norma: 1, last_seen_at: -1 },
      { name: "idx_bloques_norma_last_seen" },
    ),

    versionesCollection.createIndex({ id_version: 1 }, { unique: true, name: "uq_versiones_id_version" }),
    versionesCollection.createIndex(
      { is_latest: 1, fecha_vigencia_desde: -1 },
      { name: "idx_versiones_latest" },
    ),
    versionesCollection.createIndex(
      { id_norma: 1, id_bloque: 1, is_latest: 1 },
      { name: "idx_versiones_norma_bloque_latest" },
    ),

    // `_id` index is built-in and unique by default in MongoDB.
    chunksCollection.createIndex(
      { id_version: 1, chunk_index: 1 },
      { name: "idx_chunks_version" },
    ),
    chunksCollection.createIndex(
      { "metadata.territorio.codigo": 1 },
      { name: "idx_chunks_territorio" },
    ),

    unidadesCollection.createIndex(
      { id_unidad: 1 },
      { unique: true, name: "uq_unidades_id_unidad" },
    ),
    unidadesCollection.createIndex(
      { id_norma: 1, is_latest: 1 },
      { name: "idx_unidades_norma_latest" },
    ),
    unidadesCollection.createIndex(
      { lineage_key: 1, is_latest: 1 },
      { name: "idx_unidades_lineage_latest" },
    ),
    unidadesCollection.createIndex(
      { lineage_key: 1, fecha_vigencia_desde: 1 },
      { name: "idx_unidades_lineage_vigencia_desde" },
    ),
    unidadesCollection.createIndex(
      { "metadata.territorio.codigo": 1, "metadata.ambito_codigo": 1 },
      { name: "idx_unidades_territorio_ambito" },
    ),

    chunksSemanticosCollection.createIndex(
      { id_unidad: 1, chunk_index: 1 },
      { name: "idx_chunks_semanticos_unidad_chunk" },
    ),
    chunksSemanticosCollection.createIndex(
      { id_norma: 1 },
      { name: "idx_chunks_semanticos_norma" },
    ),
    chunksSemanticosCollection.createIndex(
      {
        "metadata.id_norma": 1,
        "metadata.fecha_vigencia_desde": 1,
        "metadata.fecha_vigencia_hasta": 1,
      },
      { name: "idx_chunks_semanticos_norma_vigencia" },
    ),
    chunksSemanticosCollection.createIndex(
      {
        "metadata.territorio.codigo": 1,
        "metadata.fecha_vigencia_desde": 1,
        "metadata.fecha_vigencia_hasta": 1,
      },
      { name: "idx_chunks_semanticos_territorio_vigencia" },
    ),
    chunksSemanticosCollection.createIndex(
      { "metadata.territorio.codigo": 1, "metadata.ambito_codigo": 1 },
      { name: "idx_chunks_semanticos_territorio_ambito" },
    ),

    territoriosCollection.createIndex(
      { codigo: 1 },
      { unique: true, name: "uq_territorios_codigo" },
    ),
    territoriosCollection.createIndex(
      { tipo: 1, departamento_codigo: 1 },
      { name: "idx_territorios_tipo_departamento" },
    ),

    indicesCollection.createIndex({ id_indice: 1 }, { unique: true, name: "uq_indices_id_indice" }),
    indicesCollection.createIndex({ id_norma: 1, is_latest: 1 }, { name: "idx_indices_latest" }),

    syncStateCollection.createIndex({ id_norma: 1 }, { unique: true, name: "uq_sync_state_norma" }),
    syncStateCollection.createIndex(
      { status: 1, last_seen_at: -1 },
      { name: "idx_sync_state_status" },
    ),
    syncStateCollection.createIndex(
      { "stages.sync.status": 1, "stages.sync.last_started_at": -1 },
      { name: "idx_sync_state_stage_sync" },
    ),
    syncStateCollection.createIndex(
      { "stages.build_units.status": 1, "stages.build_units.last_started_at": -1 },
      { name: "idx_sync_state_stage_build_units" },
    ),
    syncStateCollection.createIndex(
      { "stages.build_chunks.status": 1, "stages.build_chunks.last_started_at": -1 },
      { name: "idx_sync_state_stage_build_chunks" },
    ),
    syncStateCollection.createIndex(
      { "stages.index.status": 1, "stages.index.last_started_at": -1 },
      { name: "idx_sync_state_stage_index" },
    ),
  ]);

  logger.debug("Mongo indexes ensured");
}

export async function createMongoContext(config: AppConfig, logger: Logger): Promise<MongoContext> {
  const client = new MongoClient(config.mongoUri, {
    appName: "boe-sync-cli",
  });

  await client.connect();
  const db = client.db(config.mongoDb);

  await ensureIndexes(db, logger);

  const normasCollection = db.collection<NormaDoc>("normas");
  const bloquesCollection = db.collection<BloqueDoc>("bloques");
  const versionesCollection = db.collection<VersionDoc>("versiones");
  const chunksCollection = db.collection<ChunkDoc>("chunks");
  const indicesCollection = db.collection<IndiceDoc>("indices");
  const syncStateCollection = db.collection<SyncStateDoc>("sync_state");

  return {
    client,
    db,
    repos: {
      normas: new NormasRepository(normasCollection, logger),
      bloques: new BloquesRepository(bloquesCollection),
      versiones: new VersionesRepository(versionesCollection),
      chunks: new ChunksRepository(chunksCollection),
      indices: new IndicesRepository(indicesCollection),
      syncState: new SyncStateRepository(syncStateCollection),
    },
  };
}
