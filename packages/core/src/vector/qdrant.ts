import { QdrantClient, type Schemas } from "@qdrant/js-client-rest";

export type RagSearchMode = "NORMATIVO" | "VIGENCIA" | "MIXTO";

export const INFINITE_VIGENCIA_HASTA_MS = 253402300799000;

const NORMATIVO_TYPES = [
  "ARTICULO",
  "DISPOSICION_ADICIONAL",
  "DISPOSICION_TRANSITORIA",
  "DISPOSICION_DEROGATORIA",
  "DISPOSICION_FINAL",
  "ANEXO",
] as const;

const VIGENCIA_PRIORITY_TYPES = [
  "DISPOSICION_FINAL",
  "DISPOSICION_DEROGATORIA",
] as const;

export interface BuildRagFilterInput {
  asOfMs: number;
  territorio?: string;
  territorios?: string[];
  mode: RagSearchMode;
  includePreambulo: boolean;
}

export interface RagResultMeta {
  id_unidad: string | null;
  id_norma: string | null;
  unidad_tipo: string | null;
  unidad_ref: string | null;
  titulo: string | null;
  territorio: {
    codigo: string | null;
    tipo: string | null;
    nombre: string | null;
  };
  fecha_vigencia_desde: string | null;
  fecha_vigencia_hasta: string | null;
  url_html_consolidada: string | null;
  url_eli: string | null;
  tags: string[];
}

export interface RagVectorHit {
  idChunk: string;
  score: number;
  text: string;
  meta: RagResultMeta;
}

export interface RagVectorSearchInput {
  vector: number[];
  asOfMs: number;
  territorio?: string;
  territorios?: string[];
  mode: RagSearchMode;
  topK: number;
  minScore: number;
  includePreambulo: boolean;
}

export interface RagVectorSearchOutput {
  results: RagVectorHit[];
  qdrantTimeMs: number;
}

export interface QdrantRagClientOptions {
  collectionName: string;
  timeoutSec: number;
  maxCandidates?: number;
  candidateMultiplier?: number;
}

function asString(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(asString).filter((item): item is string => item !== null);
}

function toIsoDate(value: unknown, treatInfiniteAsNull = false): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  let ms: number;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return null;
    }
    ms = value;
  } else if (value instanceof Date) {
    ms = value.getTime();
  } else if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) {
      return null;
    }
    ms = parsed;
  } else {
    return null;
  }

  if (treatInfiniteAsNull && ms >= INFINITE_VIGENCIA_HASTA_MS) {
    return null;
  }

  return new Date(ms).toISOString();
}

export function toQdrantVigenciaHastaMs(value: Date | string | number | null | undefined): number {
  if (value === null || value === undefined) {
    return INFINITE_VIGENCIA_HASTA_MS;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return INFINITE_VIGENCIA_HASTA_MS;
    }
    return value;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return INFINITE_VIGENCIA_HASTA_MS;
  }
  return parsed;
}

function resolveUnitTypes(mode: RagSearchMode, includePreambulo: boolean): string[] {
  const fromMode: string[] = mode === "VIGENCIA" ? [...NORMATIVO_TYPES] : [...NORMATIVO_TYPES];

  const allowPreambulo = mode === "MIXTO" || includePreambulo;
  if (allowPreambulo) {
    fromMode.push("PREAMBULO");
  }

  return Array.from(new Set(fromMode));
}

function normalizeTerritorioFilterValues(territorio: string | undefined, territorios: string[] | undefined): string[] {
  if (Array.isArray(territorios)) {
    const normalized = territorios
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    if (normalized.length > 0) {
      return Array.from(new Set(normalized));
    }
  }

  if (territorio && territorio.trim().length > 0) {
    return [territorio.trim()];
  }

  return [];
}

export function buildRagFilter(input: BuildRagFilterInput): Schemas["Filter"] {
  const must: Schemas["Condition"][] = [
    {
      key: "vigencia_desde",
      range: { lte: input.asOfMs },
    },
    {
      key: "vigencia_hasta",
      range: { gt: input.asOfMs },
    },
  ];

  const territorioFilters = normalizeTerritorioFilterValues(input.territorio, input.territorios);
  if (territorioFilters.length === 1) {
    must.push({
      key: "territorio_codigo",
      match: {
        value: territorioFilters[0],
      },
    });
  } else if (territorioFilters.length > 1) {
    must.push({
      key: "territorio_codigo",
      match: {
        any: territorioFilters,
      },
    });
  }

  const allowedUnitTypes = resolveUnitTypes(input.mode, input.includePreambulo);
  must.push({
    key: "unidad_tipo",
    match: {
      any: allowedUnitTypes,
    },
  });

  return { must };
}

function calculateModeBoost(mode: RagSearchMode, payload: Record<string, unknown>): number {
  const unidadTipo = asString(payload.unidad_tipo) ?? "";
  const tags = asStringArray(payload.tags);
  const normalizedTags = tags.map((tag) => tag.toLowerCase());
  const hasNotaInicialTag = normalizedTags.includes("nota_inicial");

  if (mode === "VIGENCIA") {
    if (VIGENCIA_PRIORITY_TYPES.includes(unidadTipo as (typeof VIGENCIA_PRIORITY_TYPES)[number])) {
      return 0.08;
    }
    if (unidadTipo === "DISPOSICION_TRANSITORIA" || unidadTipo === "DISPOSICION_ADICIONAL") {
      return 0.04;
    }
    if (hasNotaInicialTag) {
      return 0.1;
    }
    if (unidadTipo === "ARTICULO") {
      return 0.02;
    }
  }

  if (mode === "MIXTO") {
    if (unidadTipo === "ARTICULO") {
      return 0.03;
    }
    if (unidadTipo.startsWith("DISPOSICION_")) {
      return 0.02;
    }
  }

  return 0;
}

function normalizePayload(payloadRaw: unknown): Record<string, unknown> {
  if (!payloadRaw || typeof payloadRaw !== "object") {
    return {};
  }
  return payloadRaw as Record<string, unknown>;
}

function normalizeScoredPoint(point: Schemas["ScoredPoint"], mode: RagSearchMode): RagVectorHit | null {
  const payload = normalizePayload(point.payload);
  const text = asString(payload.text);

  if (!text || text.trim().length === 0) {
    return null;
  }

  const boostedScore = point.score + calculateModeBoost(mode, payload);

  return {
    idChunk: typeof point.id === "string" ? point.id : String(point.id),
    score: boostedScore,
    text,
    meta: {
      id_unidad: asString(payload.id_unidad),
      id_norma: asString(payload.id_norma),
      unidad_tipo: asString(payload.unidad_tipo),
      unidad_ref: asString(payload.unidad_ref),
      titulo: asString(payload.titulo),
      territorio: {
        codigo: asString(payload.territorio_codigo),
        tipo: asString(payload.territorio_tipo),
        nombre: asString(payload.territorio_nombre),
      },
      fecha_vigencia_desde: toIsoDate(payload.vigencia_desde),
      fecha_vigencia_hasta: toIsoDate(payload.vigencia_hasta, true),
      url_html_consolidada: asString(payload.url_html_consolidada),
      url_eli: asString(payload.url_eli),
      tags: asStringArray(payload.tags),
    },
  };
}

export class QdrantRagClient {
  private readonly maxCandidates: number;
  private readonly candidateMultiplier: number;

  constructor(
    private readonly client: QdrantClient,
    private readonly options: QdrantRagClientOptions,
  ) {
    this.maxCandidates = options.maxCandidates ?? 50;
    this.candidateMultiplier = options.candidateMultiplier ?? 3;
  }

  async search(input: RagVectorSearchInput): Promise<RagVectorSearchOutput> {
    const filter = buildRagFilter({
      asOfMs: input.asOfMs,
      territorio: input.territorio,
      territorios: input.territorios,
      mode: input.mode,
      includePreambulo: input.includePreambulo,
    });

    const requestLimit = Math.min(
      this.maxCandidates,
      Math.max(input.topK, input.topK * this.candidateMultiplier),
    );

    const startedAt = Date.now();
    const points = await this.client.search(this.options.collectionName, {
      vector: input.vector,
      limit: requestLimit,
      filter,
      with_payload: true,
      timeout: this.options.timeoutSec,
    });
    const qdrantTimeMs = Date.now() - startedAt;

    const results = points
      .map((point) => normalizeScoredPoint(point, input.mode))
      .filter((item): item is RagVectorHit => item !== null)
      .filter((item) => item.score >= input.minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, input.topK);

    return {
      results,
      qdrantTimeMs,
    };
  }
}
