import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RagUnidadRecord } from "@boe/core/db/unidades";
import type { Embedder } from "@boe/core/embeddings";
import type { QdrantRagClient, RagSearchMode, RagVectorHit, RagVectorSearchOutput } from "@boe/core/qdrant";
import type { LlmChatClient } from "../llm/ollama";

export type RagScope = "ESTATAL" | "AUTONOMICO_MAS_ESTATAL";

const ESTATAL_TERRITORIO_CODIGO = "ES:STATE";
const DEFAULT_ANSWER_TOP_UNIDADES = 5;
const DEFAULT_ANSWER_MAX_UNIDAD_CHARS = 6000;

const optionalTrimmedStringSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
  z.string().trim().optional(),
);

const booleanLikeSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "") {
    return false;
  }
  return value;
}, z.boolean());

const ragScopeSchema = z.enum(["ESTATAL", "AUTONOMICO_MAS_ESTATAL"]);

const ragSearchBodySchema = z
  .object({
    query: z.string().trim().min(3, "query must be at least 3 characters"),
    asOf: optionalTrimmedStringSchema,
    territorio: optionalTrimmedStringSchema,
    scope: ragScopeSchema.optional(),
    ccaaCodigo: optionalTrimmedStringSchema,
    mode: z.enum(["NORMATIVO", "VIGENCIA", "MIXTO"]).default("NORMATIVO"),
    topK: z.coerce.number().int().min(1).max(50).default(8),
    minScore: z.coerce.number().min(0).default(0),
    includePreambulo: booleanLikeSchema.default(false),
  })
  .superRefine((value, ctx) => {
    if (value.scope === "AUTONOMICO_MAS_ESTATAL" && !value.ccaaCodigo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ccaaCodigo"],
        message: "ccaaCodigo is required when scope is AUTONOMICO_MAS_ESTATAL",
      });
    }

    if (value.ccaaCodigo && !value.ccaaCodigo.startsWith("CCAA:")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ccaaCodigo"],
        message: "ccaaCodigo must start with CCAA:",
      });
    }
  });

const unidadParamsSchema = z.object({
  id_unidad: z.string().trim().min(1, "id_unidad is required"),
});

export interface ParsedRagSearchRequest {
  query: string;
  asOf: Date;
  territorio?: string;
  scope?: RagScope;
  ccaaCodigo?: string;
  mode: RagSearchMode;
  topK: number;
  minScore: number;
  includePreambulo: boolean;
}

export interface RagUnidadStore {
  getUnidadesByIds(ids: string[]): Promise<RagUnidadRecord[]>;
  getUnidadById(idUnidad: string): Promise<RagUnidadRecord | null>;
}

export interface RagTerritorioStore {
  listAutonomicos(): Promise<
    Array<{
      codigo: string;
      nombre: string;
    }>
  >;
}

export interface RagRouteDependencies {
  embedder: Embedder;
  qdrant: QdrantRagClient;
  unidadStore?: RagUnidadStore;
  territorioStore?: RagTerritorioStore;
  answerModel?: LlmChatClient;
  answerTopUnidades?: number;
  answerMaxUnidadChars?: number;
  now?: () => Date;
}

interface ResolvedTerritorialFilter {
  territorio?: string;
  territorios?: string[];
}

interface RagSearchExecution {
  territorialFilter: ResolvedTerritorialFilter;
  embedTimeMs: number;
  searchOutput: RagVectorSearchOutput;
}

interface RagSearchResultDto {
  id_chunk: string;
  score: number;
  text: string;
  meta: {
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
  };
  citation: {
    label: string;
    url: string;
    vigencia: {
      desde: string | null;
      hasta: string | null;
    };
  };
}

interface RagUsedCitationDto {
  id_chunk: string;
  id_unidad: string | null;
  id_norma: string | null;
  label: string;
  score: number;
  territorio: {
    codigo: string | null;
    tipo: string | null;
    nombre: string | null;
  };
  vigencia: {
    desde: string | null;
    hasta: string | null;
  };
  url_html_consolidada: string | null;
  url_eli: string | null;
  excerpt: string;
}

function toUtcDayStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function parseAsOfInput(asOf: string | undefined, nowProvider: () => Date): Date {
  if (!asOf || asOf.trim().length === 0) {
    return toUtcDayStart(nowProvider());
  }

  const normalized = asOf.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return new Date(`${normalized}T00:00:00.000Z`);
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("asOf must be a valid date");
  }

  return toUtcDayStart(parsed);
}

function dedupeTerritorios(values: string[]): string[] {
  return Array.from(
    new Set(
      values
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    ),
  );
}

export function resolveTerritorialFilter(input: ParsedRagSearchRequest): ResolvedTerritorialFilter {
  if (input.scope === "ESTATAL") {
    return { territorios: [ESTATAL_TERRITORIO_CODIGO] };
  }

  if (input.scope === "AUTONOMICO_MAS_ESTATAL") {
    return {
      territorios: dedupeTerritorios([ESTATAL_TERRITORIO_CODIGO, input.ccaaCodigo ?? ""]),
    };
  }

  if (input.territorio) {
    return { territorio: input.territorio };
  }

  return {};
}

function buildFiltersResponse(
  parsed: ParsedRagSearchRequest,
  territorialFilter: ResolvedTerritorialFilter,
): Record<string, unknown> {
  const filters: Record<string, unknown> = {};

  if (parsed.scope) {
    filters.scope = parsed.scope;
  }
  if (parsed.scope === "AUTONOMICO_MAS_ESTATAL" && parsed.ccaaCodigo) {
    filters.ccaaCodigo = parsed.ccaaCodigo;
  }
  if (territorialFilter.territorios && territorialFilter.territorios.length > 0) {
    filters.territorios = territorialFilter.territorios;
  } else if (territorialFilter.territorio) {
    filters.territorio = territorialFilter.territorio;
  }

  return filters;
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}...`;
}

function looksLikeCurrentEventQuery(query: string): boolean {
  return /\b(hoy|ayer|actualidad|noticia|accidente|ultima hora|última hora|reciente|tras)\b/i.test(query);
}

function buildCitation(hit: RagVectorHit): { label: string; url: string; vigencia: { desde: string | null; hasta: string | null } } {
  const idNorma = hit.meta.id_norma ?? "NORMA";
  const unidadLabel = hit.meta.unidad_ref ?? hit.meta.unidad_tipo ?? "SIN_REF";
  const vigenciaDesde = hit.meta.fecha_vigencia_desde;
  const vigenciaLabel = vigenciaDesde
    ? `vigente desde ${vigenciaDesde.slice(0, 10)}`
    : "vigencia no disponible";
  const url = hit.meta.url_html_consolidada ?? hit.meta.url_eli ?? "";

  return {
    label: `${idNorma} - ${unidadLabel} (${vigenciaLabel})`,
    url,
    vigencia: {
      desde: hit.meta.fecha_vigencia_desde,
      hasta: hit.meta.fecha_vigencia_hasta,
    },
  };
}

function mapHitToSearchResult(hit: RagVectorHit): RagSearchResultDto {
  return {
    id_chunk: hit.idChunk,
    score: hit.score,
    text: hit.text,
    meta: {
      id_unidad: hit.meta.id_unidad,
      id_norma: hit.meta.id_norma,
      unidad_tipo: hit.meta.unidad_tipo,
      unidad_ref: hit.meta.unidad_ref,
      titulo: hit.meta.titulo,
      territorio: hit.meta.territorio,
      fecha_vigencia_desde: hit.meta.fecha_vigencia_desde,
      fecha_vigencia_hasta: hit.meta.fecha_vigencia_hasta,
      url_html_consolidada: hit.meta.url_html_consolidada,
      url_eli: hit.meta.url_eli,
    },
    citation: buildCitation(hit),
  };
}

function mapHitToUsedCitation(hit: RagVectorHit): RagUsedCitationDto {
  const citation = buildCitation(hit);
  return {
    id_chunk: hit.idChunk,
    id_unidad: hit.meta.id_unidad,
    id_norma: hit.meta.id_norma,
    label: citation.label,
    score: hit.score,
    territorio: hit.meta.territorio,
    vigencia: citation.vigencia,
    url_html_consolidada: hit.meta.url_html_consolidada,
    url_eli: hit.meta.url_eli,
    excerpt: truncateText(normalizeWhitespace(hit.text), 500),
  };
}

function collectTopUnidadIds(hits: RagVectorHit[], limit: number): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();

  for (const hit of hits) {
    const idUnidad = hit.meta.id_unidad?.trim();
    if (!idUnidad || seen.has(idUnidad)) {
      continue;
    }
    seen.add(idUnidad);
    ids.push(idUnidad);
    if (ids.length >= limit) {
      break;
    }
  }

  return ids;
}

function buildAnswerSystemPrompt(): string {
  return [
    "Eres un asistente juridico experto en normativa BOE.",
    "Reglas obligatorias:",
    "1) Responde solo con informacion soportada por el contexto proporcionado.",
    "2) No inventes hechos, fechas, medidas ni autoridades no presentes en el contexto.",
    "3) Cita explicitamente normas/unidades en formato (ID_NORMA, UNIDAD_REF).",
    "4) Si la pregunta es de actualidad o de un suceso concreto no verificable en el contexto, dilo con claridad y redirige al marco normativo disponible.",
    "5) Cierra siempre con un bloque titulado 'Citas' en bullets.",
    "6) Escribe en espanol formal y claro.",
  ].join("\n");
}

function buildAnswerUserPrompt(input: {
  parsed: ParsedRagSearchRequest;
  hits: RagVectorHit[];
  hydratedUnidades: RagUnidadRecord[];
  eventLikeQuery: boolean;
  maxUnidadChars: number;
}): string {
  const unidadesById = new Map(input.hydratedUnidades.map((unidad) => [unidad.id_unidad, unidad]));

  const retrievalEvidence = input.hits
    .slice(0, 8)
    .map((hit, index) => {
      const norm = hit.meta.id_norma ?? "NORMA";
      const unidadRef = hit.meta.unidad_ref ?? hit.meta.unidad_tipo ?? "SIN_REF";
      const territorio = hit.meta.territorio.codigo ?? "SIN_TERRITORIO";
      return [
        `[E${index + 1}] ${norm} - ${unidadRef} - score=${hit.score.toFixed(3)} - territorio=${territorio}`,
        `Extracto: ${truncateText(normalizeWhitespace(hit.text), 700)}`,
      ].join("\n");
    })
    .join("\n\n");

  const contextUnidades = collectTopUnidadIds(input.hits, input.hydratedUnidades.length || DEFAULT_ANSWER_TOP_UNIDADES)
    .map((idUnidad, index) => {
      const hydrated = unidadesById.get(idUnidad);
      if (hydrated) {
        const vigenciaHasta = hydrated.fecha_vigencia_hasta
          ? hydrated.fecha_vigencia_hasta.toISOString().slice(0, 10)
          : "vigente";
        return [
          `[U${index + 1}] id_unidad=${hydrated.id_unidad}`,
          `Norma: ${hydrated.id_norma}`,
          `Unidad: ${hydrated.unidad_ref} (${hydrated.unidad_tipo})`,
          `Vigencia: desde ${hydrated.fecha_vigencia_desde?.toISOString().slice(0, 10) ?? "N/D"} hasta ${vigenciaHasta}`,
          `Territorio: ${hydrated.territorio.nombre} (${hydrated.territorio.codigo})`,
          `Texto completo unidad:`,
          truncateText(hydrated.texto_plano, input.maxUnidadChars),
        ].join("\n");
      }

      const hit = input.hits.find((candidate) => candidate.meta.id_unidad === idUnidad);
      if (!hit) {
        return "";
      }

      return [
        `[U${index + 1}] id_unidad=${idUnidad}`,
        `Norma: ${hit.meta.id_norma ?? "NORMA"}`,
        `Unidad: ${hit.meta.unidad_ref ?? hit.meta.unidad_tipo ?? "SIN_REF"}`,
        "No se encontro la unidad completa en Mongo, usa solo este extracto como soporte:",
        truncateText(normalizeWhitespace(hit.text), input.maxUnidadChars),
      ].join("\n");
    })
    .filter((chunk) => chunk.length > 0)
    .join("\n\n---\n\n");

  const guidanceForEvent = input.eventLikeQuery
    ? "La consulta parece ligada a un suceso de actualidad. Debes aclarar que no puedes confirmar hechos noticiosos y limitarte al marco normativo recuperado."
    : "Si falta soporte textual para una afirmacion, di explicitamente que no consta en el contexto.";

  return [
    `Consulta: ${input.parsed.query}`,
    `As-of: ${input.parsed.asOf.toISOString().slice(0, 10)}`,
    `Modo retrieval: ${input.parsed.mode}`,
    guidanceForEvent,
    "",
    "Evidencia recuperada (chunks):",
    retrievalEvidence || "Sin evidencia recuperada.",
    "",
    "Contexto principal (unidades completas):",
    contextUnidades || "Sin unidades completas disponibles.",
    "",
    "Instruccion final: responde de forma util y prudente, citando explicitamente normas y unidades.",
  ].join("\n");
}

function buildFallbackAnswer(query: string, hits: RagVectorHit[], eventLike: boolean, llmError: string): string {
  const top = hits.slice(0, 3);
  const intro = eventLike
    ? "No puedo confirmar hechos de actualidad con este corpus; solo puedo aportar marco normativo aplicable."
    : "No fue posible generar redaccion con el modelo, pero si puedo devolverte las referencias recuperadas.";

  const referencias = top
    .map((hit) => `- (${hit.meta.id_norma ?? "NORMA"}, ${hit.meta.unidad_ref ?? hit.meta.unidad_tipo ?? "SIN_REF"})`)
    .join("\n");

  return [
    `${intro} Consulta: "${query}".`,
    "",
    "Referencias disponibles:",
    referencias || "- Sin referencias recuperadas.",
    "",
    `Nota tecnica: fallo del modelo (${llmError}).`,
  ].join("\n");
}

export function parseRagSearchRequest(
  input: unknown,
  nowProvider: () => Date = () => new Date(),
): ParsedRagSearchRequest {
  const body = ragSearchBodySchema.parse(input);
  const asOf = parseAsOfInput(body.asOf, nowProvider);

  return {
    query: body.query,
    asOf,
    territorio: body.territorio,
    scope: body.scope,
    ccaaCodigo: body.ccaaCodigo,
    mode: body.mode,
    topK: body.topK,
    minScore: body.minScore,
    includePreambulo: body.includePreambulo,
  };
}

async function runSearchExecution(
  parsed: ParsedRagSearchRequest,
  dependencies: RagRouteDependencies,
): Promise<RagSearchExecution> {
  const territorialFilter = resolveTerritorialFilter(parsed);

  const embedStartedAt = Date.now();
  const vector = await dependencies.embedder.embed(parsed.query);
  const embedTimeMs = Date.now() - embedStartedAt;

  const searchOutput = await dependencies.qdrant.search({
    vector,
    asOfMs: parsed.asOf.getTime(),
    territorio: territorialFilter.territorio,
    territorios: territorialFilter.territorios,
    mode: parsed.mode,
    topK: parsed.topK,
    minScore: parsed.minScore,
    includePreambulo: parsed.includePreambulo,
  });

  return {
    territorialFilter,
    embedTimeMs,
    searchOutput,
  };
}

export async function registerRagRoutes(
  app: FastifyInstance,
  dependencies: RagRouteDependencies,
): Promise<void> {
  const nowProvider = dependencies.now ?? (() => new Date());

  app.get("/rag/catalog/ccaa", async (request, reply) => {
    if (!dependencies.territorioStore) {
      return reply.status(503).send({
        error: "RAG_CCAA_CATALOG_NOT_READY",
        message: "territorioStore dependency is not configured",
      });
    }

    try {
      const items = await dependencies.territorioStore.listAutonomicos();
      return reply.send({ items });
    } catch (error) {
      request.log.error({ err: error }, "rag-catalog-ccaa failed");
      return reply.status(500).send({
        error: "RAG_CCAA_CATALOG_ERROR",
      });
    }
  });

  app.post("/rag/search", async (request, reply) => {
    let parsed: ParsedRagSearchRequest;
    try {
      parsed = parseRagSearchRequest(request.body, nowProvider);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send({
        error: "Invalid request",
        message,
      });
    }

    try {
      const execution = await runSearchExecution(parsed, dependencies);

      return reply.send({
        query: parsed.query,
        asOf: parsed.asOf.toISOString(),
        mode: parsed.mode,
        filters: buildFiltersResponse(parsed, execution.territorialFilter),
        results: execution.searchOutput.results.map(mapHitToSearchResult),
        stats: {
          topK: parsed.topK,
          returned: execution.searchOutput.results.length,
          qdrantTimeMs: execution.searchOutput.qdrantTimeMs,
          embedTimeMs: execution.embedTimeMs,
        },
      });
    } catch (error) {
      request.log.error({ err: error }, "rag-search failed");
      return reply.status(500).send({
        error: "RAG_SEARCH_ERROR",
      });
    }
  });

  app.post("/rag/answer", async (request, reply) => {
    if (!dependencies.unidadStore || !dependencies.answerModel) {
      return reply.status(503).send({
        error: "RAG_ANSWER_NOT_READY",
        message: "answerModel/unidadStore dependencies are not configured",
      });
    }

    let parsed: ParsedRagSearchRequest;
    try {
      parsed = parseRagSearchRequest(request.body, nowProvider);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send({
        error: "Invalid request",
        message,
      });
    }

    try {
      const execution = await runSearchExecution(parsed, dependencies);
      const answerTopUnidades = Math.max(1, dependencies.answerTopUnidades ?? DEFAULT_ANSWER_TOP_UNIDADES);
      const answerMaxUnidadChars = Math.max(
        500,
        dependencies.answerMaxUnidadChars ?? DEFAULT_ANSWER_MAX_UNIDAD_CHARS,
      );

      const topUnidadIds = collectTopUnidadIds(execution.searchOutput.results, answerTopUnidades);
      const hydratedUnidades = await dependencies.unidadStore.getUnidadesByIds(topUnidadIds);
      const eventLikeQuery = looksLikeCurrentEventQuery(parsed.query);

      const systemPrompt = buildAnswerSystemPrompt();
      const userPrompt = buildAnswerUserPrompt({
        parsed,
        hits: execution.searchOutput.results,
        hydratedUnidades,
        eventLikeQuery,
        maxUnidadChars: answerMaxUnidadChars,
      });

      const llmStartedAt = Date.now();
      let llmError: string | null = null;
      let answer: string;

      try {
        answer = await dependencies.answerModel.complete([
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ]);
      } catch (error) {
        llmError = error instanceof Error ? error.message : String(error);
        request.log.error({ err: llmError }, "rag-answer llm failed; using fallback");
        answer = buildFallbackAnswer(parsed.query, execution.searchOutput.results, eventLikeQuery, llmError);
      }

      const llmTimeMs = Date.now() - llmStartedAt;

      return reply.send({
        query: parsed.query,
        asOf: parsed.asOf.toISOString(),
        mode: parsed.mode,
        filters: buildFiltersResponse(parsed, execution.territorialFilter),
        answer,
        usedCitations: execution.searchOutput.results.map(mapHitToUsedCitation),
        stats: {
          topK: parsed.topK,
          returned: execution.searchOutput.results.length,
          qdrantTimeMs: execution.searchOutput.qdrantTimeMs,
          embedTimeMs: execution.embedTimeMs,
          llmTimeMs,
          hydratedUnidades: hydratedUnidades.length,
        },
        debug: {
          llmFallback: llmError !== null,
          llmError,
          retrieved: execution.searchOutput.results.map((hit) => ({
            id_chunk: hit.idChunk,
            id_unidad: hit.meta.id_unidad,
            score: hit.score,
            id_norma: hit.meta.id_norma,
            unidad_ref: hit.meta.unidad_ref,
          })),
        },
      });
    } catch (error) {
      request.log.error({ err: error }, "rag-answer failed");
      return reply.status(500).send({
        error: "RAG_ANSWER_ERROR",
      });
    }
  });

  app.get("/rag/unidad/:id_unidad", async (request, reply) => {
    if (!dependencies.unidadStore) {
      return reply.status(503).send({
        error: "RAG_UNIDAD_NOT_READY",
        message: "unidadStore dependency is not configured",
      });
    }

    let params: { id_unidad: string };
    try {
      params = unidadParamsSchema.parse(request.params);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send({
        error: "Invalid params",
        message,
      });
    }

    try {
      const unidad = await dependencies.unidadStore.getUnidadById(params.id_unidad);
      if (!unidad) {
        return reply.status(404).send({
          error: "UNIDAD_NOT_FOUND",
        });
      }

      return reply.send({
        id_unidad: unidad.id_unidad,
        id_norma: unidad.id_norma,
        unidad_tipo: unidad.unidad_tipo,
        unidad_ref: unidad.unidad_ref,
        titulo: unidad.titulo,
        texto_plano: unidad.texto_plano,
        territorio: unidad.territorio,
        fecha_vigencia_desde: unidad.fecha_vigencia_desde?.toISOString() ?? null,
        fecha_vigencia_hasta: unidad.fecha_vigencia_hasta?.toISOString() ?? null,
        url_html_consolidada: unidad.url_html_consolidada,
        url_eli: unidad.url_eli,
      });
    } catch (error) {
      request.log.error({ err: error }, "rag-unidad failed");
      return reply.status(500).send({
        error: "RAG_UNIDAD_ERROR",
      });
    }
  });
}
