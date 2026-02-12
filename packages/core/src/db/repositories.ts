import type {
  Collection,
  Filter,
  FindOptions,
  WithId,
} from "mongodb";
import type { Logger } from "pino";
import type { BloqueIndiceNormalized, NormaNormalized } from "../types";
import type { TerritorioNormalized } from "../utils/territorio";

export interface NormaDoc {
  _id: string;
  id_norma: string;
  titulo: string | null;
  rango_texto: string | null;
  departamento_texto: string | null;
  ambito_texto: string | null;
  ambito_codigo: string | null;
  departamento_codigo: string | null;
  territorio: TerritorioNormalized;
  fecha_actualizacion: Date | null;
  fecha_publicacion: Date | null;
  fecha_disposicion: Date | null;
  url_html_consolidada: string | null;
  raw_item_json: Record<string, unknown>;
  first_seen_at: Date;
  last_seen_at: Date;
}

export interface BloqueDoc {
  _id: string;
  id_norma: string;
  id_bloque: string;
  tipo: string | null;
  titulo_bloque: string | null;
  fecha_actualizacion_bloque: Date | null;
  fecha_actualizacion_bloque_raw: string | null;
  url_bloque: string | null;
  latest_version_id: string | null;
  first_seen_at: Date;
  last_seen_at: Date;
}

export interface VersionChunkingDoc {
  method: "recursive" | "simple";
  chunk_size: number;
  overlap: number;
}

export interface VersionDoc {
  _id: string;
  id_version: string;
  id_norma: string;
  id_bloque: string;
  fecha_vigencia_desde: Date | null;
  fecha_vigencia_desde_raw: string | null;
  fecha_publicacion_mod: Date | null;
  fecha_publicacion_mod_raw: string | null;
  id_norma_modificadora: string | null;
  hash_xml: string;
  hash_xml_pretty: string;
  file_path: string;
  is_latest: boolean;
  xml_raw?: string | null;
  xml_pretty?: string | null;
  texto_plano?: string | null;
  texto_hash?: string | null;
  n_chars?: number | null;
  n_tokens_est?: number | null;
  chunking?: VersionChunkingDoc | null;
  created_at: Date;
  last_seen_at: Date;
}

export interface ChunkMetadataDoc {
  titulo_norma: string | null;
  rango_texto: string | null;
  ambito_texto: string | null;
  territorio: {
    codigo: string | null;
  };
  departamento_texto: string | null;
  fecha_vigencia_desde: Date | null;
  url_html_consolidada: string | null;
  url_bloque: string | null;
}

export interface ChunkDoc {
  _id: string;
  id_version: string;
  id_norma: string;
  id_bloque: string;
  chunk_index: number;
  texto: string;
  texto_hash: string;
  metadata: ChunkMetadataDoc;
  created_at: Date;
  last_seen_at: Date;
}

export interface IndiceDoc {
  _id: string;
  id_indice: string;
  id_norma: string;
  fecha_actualizacion_indice: Date | null;
  fecha_actualizacion_indice_raw: string | null;
  hash_xml: string;
  hash_xml_pretty: string;
  file_path: string;
  is_latest: boolean;
  created_at: Date;
  last_seen_at: Date;
}

export type SyncStageName = "sync" | "build_units" | "build_chunks" | "index";

export type SyncStageStatus = "pending" | "running" | "ok" | "failed";

export interface SyncStateStageDoc {
  status: SyncStageStatus;
  last_started_at: Date | null;
  last_finished_at: Date | null;
  last_error: string | null;
}

export interface SyncStateStagesDoc {
  sync: SyncStateStageDoc;
  build_units: SyncStateStageDoc;
  build_chunks: SyncStateStageDoc;
  index: SyncStateStageDoc;
}

export interface SyncStateAttemptsDoc {
  sync: number;
  build_units: number;
  build_chunks: number;
  index: number;
}

export interface SyncStateDoc {
  _id: string;
  id_norma: string;
  status: SyncStageStatus;
  stages: SyncStateStagesDoc;
  attempts: SyncStateAttemptsDoc;
  last_seen_at: Date;
  last_started_at: Date | null;
  last_finished_at: Date | null;
  last_error_message: string | null;
}

export interface SyncNormaFilters {
  from?: Date;
  to?: Date;
  ids?: string[];
  limit?: number;
}

export interface InsertVersionResult {
  inserted: boolean;
  existing: VersionDoc | null;
}

function isSameDate(a: Date | null | undefined, b: Date | null | undefined): boolean {
  if ((a ?? null) === null && (b ?? null) === null) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  return a.getTime() === b.getTime();
}

function isSameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function isSameTerritorio(a: TerritorioNormalized | undefined, b: TerritorioNormalized): boolean {
  if (!a) {
    return false;
  }

  return a.tipo === b.tipo && a.codigo === b.codigo && a.nombre === b.nombre;
}

function isSameChunking(
  current: VersionChunkingDoc | null | undefined,
  next: VersionChunkingDoc,
): boolean {
  if (!current) {
    return false;
  }

  return (
    current.method === next.method &&
    current.chunk_size === next.chunk_size &&
    current.overlap === next.overlap
  );
}

const SYNC_STAGE_ORDER: SyncStageName[] = [
  "sync",
  "build_units",
  "build_chunks",
  "index",
];

function normalizeLegacySyncStatus(status: unknown): SyncStageStatus {
  if (status === "running" || status === "ok" || status === "pending" || status === "failed") {
    return status;
  }

  if (status === "error") {
    return "failed";
  }

  return "pending";
}

function buildDefaultStageState(): SyncStateStageDoc {
  return {
    status: "pending",
    last_started_at: null,
    last_finished_at: null,
    last_error: null,
  };
}

function buildDefaultStages(): SyncStateStagesDoc {
  return {
    sync: buildDefaultStageState(),
    build_units: buildDefaultStageState(),
    build_chunks: buildDefaultStageState(),
    index: buildDefaultStageState(),
  };
}

function buildDefaultAttempts(): SyncStateAttemptsDoc {
  return {
    sync: 0,
    build_units: 0,
    build_chunks: 0,
    index: 0,
  };
}

function coerceStageState(value: unknown): SyncStateStageDoc {
  if (!value || typeof value !== "object") {
    return buildDefaultStageState();
  }

  const row = value as Record<string, unknown>;
  const status = normalizeLegacySyncStatus(row.status);
  const lastStartedAt = row.last_started_at instanceof Date ? row.last_started_at : null;
  const lastFinishedAt = row.last_finished_at instanceof Date ? row.last_finished_at : null;
  const lastError = typeof row.last_error === "string" ? row.last_error : null;

  return {
    status,
    last_started_at: lastStartedAt,
    last_finished_at: lastFinishedAt,
    last_error: lastError,
  };
}

function coerceStages(value: unknown): SyncStateStagesDoc {
  if (!value || typeof value !== "object") {
    return buildDefaultStages();
  }

  const row = value as Record<string, unknown>;
  return {
    sync: coerceStageState(row.sync),
    build_units: coerceStageState(row.build_units),
    build_chunks: coerceStageState(row.build_chunks),
    index: coerceStageState(row.index),
  };
}

function coerceAttempts(value: unknown): SyncStateAttemptsDoc {
  if (!value || typeof value !== "object") {
    return buildDefaultAttempts();
  }

  const row = value as Record<string, unknown>;
  const asNumber = (field: unknown): number => {
    if (typeof field === "number" && Number.isFinite(field) && field >= 0) {
      return field;
    }
    return 0;
  };

  return {
    sync: asNumber(row.sync),
    build_units: asNumber(row.build_units),
    build_chunks: asNumber(row.build_chunks),
    index: asNumber(row.index),
  };
}

function buildInsertDefaults(idNorma: string, _now: Date): Pick<
  SyncStateDoc,
  "_id" | "id_norma"
> {
  return {
    _id: idNorma,
    id_norma: idNorma,
  };
}

export class NormasRepository {
  constructor(
    private readonly collection: Collection<NormaDoc>,
    private readonly logger: Logger,
  ) {}

  async findById(idNorma: string): Promise<WithId<NormaDoc> | null> {
    return this.collection.findOne({ id_norma: idNorma });
  }

  async upsertFromDiscover(norma: NormaNormalized, now: Date, dryRun: boolean): Promise<void> {
    const existing = await this.findById(norma.id_norma);

    if (!existing) {
      if (!dryRun) {
        await this.collection.insertOne({
          _id: norma.id_norma,
          ...norma,
          first_seen_at: now,
          last_seen_at: now,
        });
      }
      return;
    }

    const metadataChanged =
      existing.titulo !== norma.titulo ||
      existing.rango_texto !== norma.rango_texto ||
      existing.departamento_texto !== norma.departamento_texto ||
      existing.ambito_texto !== norma.ambito_texto ||
      existing.ambito_codigo !== norma.ambito_codigo ||
      existing.departamento_codigo !== norma.departamento_codigo ||
      !isSameTerritorio(existing.territorio, norma.territorio) ||
      !isSameDate(existing.fecha_actualizacion, norma.fecha_actualizacion) ||
      !isSameDate(existing.fecha_publicacion, norma.fecha_publicacion) ||
      !isSameDate(existing.fecha_disposicion, norma.fecha_disposicion) ||
      existing.url_html_consolidada !== norma.url_html_consolidada ||
      !isSameJson(existing.raw_item_json, norma.raw_item_json);

    if (dryRun) {
      return;
    }

    if (!metadataChanged) {
      await this.collection.updateOne(
        { id_norma: norma.id_norma },
        { $set: { last_seen_at: now } },
      );
      return;
    }

    await this.collection.updateOne(
      { id_norma: norma.id_norma },
      {
        $set: {
          ...norma,
          last_seen_at: now,
        },
      },
    );
  }

  async updateTerritorioById(
    idNorma: string,
    payload: {
      ambito_codigo: string | null;
      departamento_codigo: string | null;
      territorio: TerritorioNormalized;
    },
    dryRun: boolean,
  ): Promise<boolean> {
    const existing = await this.findById(idNorma);
    if (!existing) {
      return false;
    }

    const changed =
      existing.ambito_codigo !== payload.ambito_codigo ||
      existing.departamento_codigo !== payload.departamento_codigo ||
      !isSameTerritorio(existing.territorio, payload.territorio);

    if (!changed) {
      return false;
    }

    if (!dryRun) {
      await this.collection.updateOne(
        { id_norma: idNorma },
        {
          $set: {
            ambito_codigo: payload.ambito_codigo,
            departamento_codigo: payload.departamento_codigo,
            territorio: payload.territorio,
          },
        },
      );
    }

    return true;
  }

  async listForSync(filters: SyncNormaFilters): Promise<NormaDoc[]> {
    const query: Filter<NormaDoc> = {};

    if (filters.ids && filters.ids.length > 0) {
      query.id_norma = { $in: filters.ids };
    } else if (filters.from || filters.to) {
      query.fecha_actualizacion = {} as { $gte?: Date; $lte?: Date };
      if (filters.from) {
        query.fecha_actualizacion.$gte = filters.from;
      }
      if (filters.to) {
        query.fecha_actualizacion.$lte = filters.to;
      }
    }

    const options: FindOptions = {
      sort: { fecha_actualizacion: -1, id_norma: 1 },
    };

    if (typeof filters.limit === "number" && filters.limit > 0) {
      options.limit = filters.limit;
    }

    return this.collection.find(query, options).toArray();
  }
}

export class BloquesRepository {
  constructor(private readonly collection: Collection<BloqueDoc>) {}

  static buildId(idNorma: string, idBloque: string): string {
    return `${idNorma}:${idBloque}`;
  }

  async findByNormaBloque(idNorma: string, idBloque: string): Promise<BloqueDoc | null> {
    return this.collection.findOne({ id_norma: idNorma, id_bloque: idBloque });
  }

  async upsertFromIndice(
    idNorma: string,
    bloque: BloqueIndiceNormalized,
    now: Date,
    dryRun: boolean,
  ): Promise<BloqueDoc | null> {
    const existing = await this.findByNormaBloque(idNorma, bloque.id_bloque);

    if (!existing) {
      if (!dryRun) {
        const doc: BloqueDoc = {
          _id: BloquesRepository.buildId(idNorma, bloque.id_bloque),
          id_norma: idNorma,
          id_bloque: bloque.id_bloque,
          tipo: bloque.tipo,
          titulo_bloque: bloque.titulo_bloque,
          fecha_actualizacion_bloque: bloque.fecha_actualizacion_bloque,
          fecha_actualizacion_bloque_raw: bloque.fecha_actualizacion_bloque_raw,
          url_bloque: bloque.url_bloque,
          latest_version_id: null,
          first_seen_at: now,
          last_seen_at: now,
        };
        await this.collection.insertOne(doc);
        return doc;
      }

      return {
        _id: BloquesRepository.buildId(idNorma, bloque.id_bloque),
        id_norma: idNorma,
        id_bloque: bloque.id_bloque,
        tipo: bloque.tipo,
        titulo_bloque: bloque.titulo_bloque,
        fecha_actualizacion_bloque: bloque.fecha_actualizacion_bloque,
        fecha_actualizacion_bloque_raw: bloque.fecha_actualizacion_bloque_raw,
        url_bloque: bloque.url_bloque,
        latest_version_id: null,
        first_seen_at: now,
        last_seen_at: now,
      };
    }

    if (dryRun) {
      return existing;
    }

    const metadataChanged =
      existing.tipo !== bloque.tipo ||
      existing.titulo_bloque !== bloque.titulo_bloque ||
      !isSameDate(existing.fecha_actualizacion_bloque, bloque.fecha_actualizacion_bloque) ||
      existing.fecha_actualizacion_bloque_raw !== bloque.fecha_actualizacion_bloque_raw ||
      existing.url_bloque !== bloque.url_bloque;

    if (!metadataChanged) {
      await this.collection.updateOne(
        { id_norma: idNorma, id_bloque: bloque.id_bloque },
        { $set: { last_seen_at: now } },
      );
      return {
        ...existing,
        last_seen_at: now,
      };
    }

    await this.collection.updateOne(
      { id_norma: idNorma, id_bloque: bloque.id_bloque },
      {
        $set: {
          tipo: bloque.tipo,
          titulo_bloque: bloque.titulo_bloque,
          fecha_actualizacion_bloque: bloque.fecha_actualizacion_bloque,
          fecha_actualizacion_bloque_raw: bloque.fecha_actualizacion_bloque_raw,
          url_bloque: bloque.url_bloque,
          last_seen_at: now,
        },
      },
    );

    return {
      ...existing,
      tipo: bloque.tipo,
      titulo_bloque: bloque.titulo_bloque,
      fecha_actualizacion_bloque: bloque.fecha_actualizacion_bloque,
      fecha_actualizacion_bloque_raw: bloque.fecha_actualizacion_bloque_raw,
      url_bloque: bloque.url_bloque,
      last_seen_at: now,
    };
  }

  async updateBloqueMetadataFromBloqueXml(
    idNorma: string,
    idBloque: string,
    input: { tipo: string | null; titulo_bloque: string | null },
    now: Date,
    dryRun: boolean,
  ): Promise<void> {
    if (dryRun) {
      return;
    }

    await this.collection.updateOne(
      { id_norma: idNorma, id_bloque: idBloque },
      {
        $set: {
          tipo: input.tipo,
          titulo_bloque: input.titulo_bloque,
          last_seen_at: now,
        },
      },
    );
  }

  async setLatestVersionId(
    idNorma: string,
    idBloque: string,
    latestVersionId: string,
    dryRun: boolean,
  ): Promise<void> {
    if (dryRun) {
      return;
    }

    await this.collection.updateOne(
      { id_norma: idNorma, id_bloque: idBloque },
      {
        $set: {
          latest_version_id: latestVersionId,
        },
      },
    );
  }
}

export class VersionesRepository {
  constructor(private readonly collection: Collection<VersionDoc>) {}

  async findById(idVersion: string): Promise<VersionDoc | null> {
    return this.collection.findOne({ id_version: idVersion });
  }

  async touchLastSeen(idVersion: string, now: Date, dryRun: boolean): Promise<void> {
    if (dryRun) {
      return;
    }

    await this.collection.updateOne(
      { id_version: idVersion },
      {
        $set: {
          last_seen_at: now,
        },
      },
    );
  }

  async insertIfMissing(doc: VersionDoc, dryRun: boolean): Promise<InsertVersionResult> {
    const existing = await this.findById(doc.id_version);
    if (existing) {
      if (!dryRun) {
        await this.collection.updateOne(
          { id_version: doc.id_version },
          { $set: { last_seen_at: doc.last_seen_at } },
        );
      }
      return {
        inserted: false,
        existing,
      };
    }

    if (dryRun) {
      return {
        inserted: true,
        existing: null,
      };
    }

    await this.collection.insertOne(doc);
    return {
      inserted: true,
      existing: null,
    };
  }

  async upsertRagFields(
    idVersion: string,
    payload: {
      xml_raw: string | null;
      xml_pretty: string | null;
      texto_plano: string;
      texto_hash: string;
      n_chars: number;
      n_tokens_est: number;
      chunking: VersionChunkingDoc;
    },
    now: Date,
    dryRun: boolean,
  ): Promise<boolean> {
    const existing = await this.findById(idVersion);
    if (!existing) {
      return false;
    }

    const changed =
      existing.xml_raw !== payload.xml_raw ||
      existing.xml_pretty !== payload.xml_pretty ||
      existing.texto_plano !== payload.texto_plano ||
      existing.texto_hash !== payload.texto_hash ||
      existing.n_chars !== payload.n_chars ||
      existing.n_tokens_est !== payload.n_tokens_est ||
      !isSameChunking(existing.chunking, payload.chunking);

    if (!changed) {
      if (!dryRun) {
        await this.touchLastSeen(idVersion, now, false);
      }
      return false;
    }

    if (!dryRun) {
      await this.collection.updateOne(
        { id_version: idVersion },
        {
          $set: {
            xml_raw: payload.xml_raw,
            xml_pretty: payload.xml_pretty,
            texto_plano: payload.texto_plano,
            texto_hash: payload.texto_hash,
            n_chars: payload.n_chars,
            n_tokens_est: payload.n_tokens_est,
            chunking: payload.chunking,
            last_seen_at: now,
          },
        },
      );
    }

    return true;
  }

  async markLatestForBlock(
    idNorma: string,
    idBloque: string,
    latestId: string,
    dryRun: boolean,
  ): Promise<void> {
    if (dryRun) {
      return;
    }

    await this.collection.updateMany(
      {
        id_norma: idNorma,
        id_bloque: idBloque,
        id_version: { $ne: latestId },
        is_latest: true,
      },
      {
        $set: { is_latest: false },
      },
    );

    await this.collection.updateOne(
      {
        id_norma: idNorma,
        id_bloque: idBloque,
        id_version: latestId,
      },
      {
        $set: {
          is_latest: true,
        },
      },
    );
  }

  async getLatestByBlock(idNorma: string, idBloque: string): Promise<VersionDoc | null> {
    return this.collection.findOne(
      {
        id_norma: idNorma,
        id_bloque: idBloque,
        is_latest: true,
      },
      {
        sort: { fecha_vigencia_desde: -1, created_at: -1 },
      },
    );
  }
}

export class ChunksRepository {
  constructor(private readonly collection: Collection<ChunkDoc>) {}

  async findById(idChunk: string): Promise<ChunkDoc | null> {
    return this.collection.findOne({ _id: idChunk });
  }

  async insertIfMissing(doc: ChunkDoc, dryRun: boolean): Promise<boolean> {
    const existing = await this.findById(doc._id);
    if (existing) {
      if (!dryRun) {
        await this.collection.updateOne(
          { _id: doc._id },
          {
            $set: {
              last_seen_at: doc.last_seen_at,
            },
          },
        );
      }
      return false;
    }

    if (dryRun) {
      return true;
    }

    await this.collection.insertOne(doc);
    return true;
  }

  async touchByVersion(idVersion: string, now: Date, dryRun: boolean): Promise<number> {
    if (dryRun) {
      return 0;
    }

    const result = await this.collection.updateMany(
      { id_version: idVersion },
      {
        $set: {
          last_seen_at: now,
        },
      },
    );

    return result.modifiedCount;
  }
}

export class IndicesRepository {
  constructor(private readonly collection: Collection<IndiceDoc>) {}

  async findById(idIndice: string): Promise<IndiceDoc | null> {
    return this.collection.findOne({ id_indice: idIndice });
  }

  async insertIfMissing(doc: IndiceDoc, dryRun: boolean): Promise<boolean> {
    const existing = await this.findById(doc.id_indice);

    if (existing) {
      if (!dryRun) {
        await this.collection.updateOne(
          { id_indice: doc.id_indice },
          {
            $set: {
              last_seen_at: doc.last_seen_at,
            },
          },
        );
      }
      return false;
    }

    if (dryRun) {
      return true;
    }

    await this.collection.insertOne(doc);
    return true;
  }

  async markLatestForNorma(idNorma: string, latestIdIndice: string, dryRun: boolean): Promise<void> {
    if (dryRun) {
      return;
    }

    await this.collection.updateMany(
      {
        id_norma: idNorma,
        id_indice: { $ne: latestIdIndice },
        is_latest: true,
      },
      {
        $set: { is_latest: false },
      },
    );

    await this.collection.updateOne(
      {
        id_norma: idNorma,
        id_indice: latestIdIndice,
      },
      {
        $set: { is_latest: true },
      },
    );
  }
}

export class SyncStateRepository {
  constructor(private readonly collection: Collection<SyncStateDoc>) {}

  private normalizeDoc(doc: SyncStateDoc): SyncStateDoc {
    const raw = doc as unknown as Record<string, unknown>;
    const now = new Date();
    const stages = coerceStages(raw.stages);
    const attempts = coerceAttempts(raw.attempts);
    const normalizedStatus = normalizeLegacySyncStatus(raw.status);
    const legacyStarted = raw.last_started_at instanceof Date ? raw.last_started_at : null;
    const legacyFinished = raw.last_finished_at instanceof Date ? raw.last_finished_at : null;

    return {
      ...doc,
      status: normalizedStatus,
      stages,
      attempts,
      last_seen_at: raw.last_seen_at instanceof Date ? raw.last_seen_at : legacyFinished ?? legacyStarted ?? now,
      last_started_at: legacyStarted,
      last_finished_at: legacyFinished,
      last_error_message: typeof raw.last_error_message === "string" ? raw.last_error_message : null,
    };
  }

  async findByNorma(idNorma: string): Promise<SyncStateDoc | null> {
    const doc = await this.collection.findOne({ id_norma: idNorma });
    if (!doc) {
      return null;
    }

    return this.normalizeDoc(doc);
  }

  async ensureNormaPending(
    idNorma: string,
    now: Date,
    dryRun: boolean,
    options: { forceResetStages?: boolean } = {},
  ): Promise<void> {
    if (dryRun) {
      return;
    }

    const setPayload: Record<string, unknown> = {
      status: "pending",
      last_seen_at: now,
      last_error_message: null,
    };

    if (options.forceResetStages) {
      setPayload.status = "pending";
      setPayload.stages = buildDefaultStages();
      setPayload.attempts = buildDefaultAttempts();
      setPayload.last_started_at = null;
      setPayload.last_finished_at = null;
      setPayload.last_error_message = null;
    }

    await this.collection.updateOne(
      { id_norma: idNorma },
      {
        $set: setPayload,
        $setOnInsert: buildInsertDefaults(idNorma, now),
      },
      { upsert: true },
    );
  }

  async ensureNormasPending(
    idNormas: string[],
    now: Date,
    dryRun: boolean,
    options: { forceResetStages?: boolean } = {},
  ): Promise<void> {
    if (dryRun || idNormas.length === 0) {
      return;
    }

    await this.collection.bulkWrite(
      idNormas.map((idNorma) => {
        const setPayload: Record<string, unknown> = {
          status: "pending",
          last_seen_at: now,
          last_error_message: null,
        };

        if (options.forceResetStages) {
          setPayload.status = "pending";
          setPayload.stages = buildDefaultStages();
          setPayload.attempts = buildDefaultAttempts();
          setPayload.last_started_at = null;
          setPayload.last_finished_at = null;
          setPayload.last_error_message = null;
        }

        return {
          updateOne: {
            filter: { id_norma: idNorma },
            update: {
              $set: setPayload,
              $setOnInsert: buildInsertDefaults(idNorma, now),
            },
            upsert: true,
          },
        };
      }),
    );
  }

  async listByStatus(statuses: SyncStageStatus[], limit?: number): Promise<SyncStateDoc[]> {
    const query: Filter<SyncStateDoc> = {};
    if (statuses.length > 0) {
      query.status = { $in: statuses };
    }

    const cursor = this.collection.find(query).sort({ last_seen_at: -1, id_norma: 1 });
    if (typeof limit === "number" && limit > 0) {
      cursor.limit(limit);
    }

    const docs = await cursor.toArray();
    return docs.map((doc) => this.normalizeDoc(doc));
  }

  async markStageStart(
    idNorma: string,
    stage: SyncStageName,
    now: Date,
    dryRun: boolean,
  ): Promise<void> {
    if (dryRun) {
      return;
    }

    const stagePosition = SYNC_STAGE_ORDER.indexOf(stage);
    const setPayload: Record<string, unknown> = {
      status: "running",
      last_seen_at: now,
      last_started_at: now,
      last_error_message: null,
      [`stages.${stage}.status`]: "running",
      [`stages.${stage}.last_started_at`]: now,
      [`stages.${stage}.last_error`]: null,
    };

    for (const downstreamStage of SYNC_STAGE_ORDER.slice(stagePosition + 1)) {
      setPayload[`stages.${downstreamStage}.status`] = "pending";
      setPayload[`stages.${downstreamStage}.last_error`] = null;
    }

    await this.collection.updateOne(
      { id_norma: idNorma },
      {
        $set: setPayload,
        $inc: {
          [`attempts.${stage}`]: 1,
        },
        $setOnInsert: buildInsertDefaults(idNorma, now),
      },
      { upsert: true },
    );
  }

  async markStageSuccess(
    idNorma: string,
    stage: SyncStageName,
    now: Date,
    dryRun: boolean,
    options: { completeNorma?: boolean } = {},
  ): Promise<void> {
    if (dryRun) {
      return;
    }

    const completeNorma = options.completeNorma ?? stage === "index";
    const stagePosition = SYNC_STAGE_ORDER.indexOf(stage);
    const setPayload: Record<string, unknown> = {
      last_seen_at: now,
      last_error_message: null,
      status: completeNorma ? "ok" : "running",
      last_finished_at: completeNorma ? now : null,
      [`stages.${stage}.status`]: "ok",
      [`stages.${stage}.last_finished_at`]: now,
      [`stages.${stage}.last_error`]: null,
    };

    if (!completeNorma) {
      for (const downstreamStage of SYNC_STAGE_ORDER.slice(stagePosition + 1)) {
        setPayload[`stages.${downstreamStage}.status`] = "pending";
        setPayload[`stages.${downstreamStage}.last_error`] = null;
      }
    }

    await this.collection.updateOne(
      { id_norma: idNorma },
      {
        $set: setPayload,
        $setOnInsert: buildInsertDefaults(idNorma, now),
      },
      { upsert: true },
    );
  }

  async markStageFailure(
    idNorma: string,
    stage: SyncStageName,
    error: string,
    now: Date,
    dryRun: boolean,
  ): Promise<void> {
    if (dryRun) {
      return;
    }

    await this.collection.updateOne(
      { id_norma: idNorma },
      {
        $set: {
          status: "failed",
          last_seen_at: now,
          last_finished_at: now,
          last_error_message: error,
          [`stages.${stage}.status`]: "failed",
          [`stages.${stage}.last_finished_at`]: now,
          [`stages.${stage}.last_error`]: error,
        },
        $setOnInsert: buildInsertDefaults(idNorma, now),
      },
      { upsert: true },
    );
  }

  // Legacy sync helpers used by the old ingestor CLI path.
  async markNormaStart(idNorma: string, now: Date, dryRun: boolean): Promise<void> {
    await this.markStageStart(idNorma, "sync", now, dryRun);
  }

  // Legacy sync helpers used by the old ingestor CLI path.
  async markNormaSuccess(idNorma: string, now: Date, dryRun: boolean): Promise<void> {
    await this.markStageSuccess(idNorma, "sync", now, dryRun, { completeNorma: true });
  }

  // Legacy sync helpers used by the old ingestor CLI path.
  async markNormaError(idNorma: string, error: string, now: Date, dryRun: boolean): Promise<void> {
    await this.markStageFailure(idNorma, "sync", error, now, dryRun);
  }
}
