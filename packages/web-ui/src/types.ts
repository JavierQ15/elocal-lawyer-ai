export type ChatRole = "user" | "assistant";

export type RagSearchMode = "NORMATIVO" | "VIGENCIA" | "MIXTO";
export type RagScope = "ESTATAL" | "AUTONOMICO_MAS_ESTATAL";

export interface SearchFiltersState {
  asOf: string;
  mode: RagSearchMode;
  scope: RagScope;
  ccaaCodigo: string;
  topK: number;
  minScore: number;
  includePreambulo: boolean;
}

export interface RagSearchRequest {
  query: string;
  asOf: string;
  scope: RagScope;
  ccaaCodigo?: string;
  mode: RagSearchMode;
  topK: number;
  minScore: number;
  includePreambulo: boolean;
}

export interface RagResultTerritorio {
  codigo: string | null;
  tipo: string | null;
  nombre: string | null;
}

export interface RagResultMeta {
  id_unidad: string | null;
  id_norma: string | null;
  unidad_tipo: string | null;
  unidad_ref: string | null;
  titulo: string | null;
  territorio: RagResultTerritorio;
  fecha_vigencia_desde: string | null;
  fecha_vigencia_hasta: string | null;
  url_html_consolidada: string | null;
  url_eli: string | null;
}

export interface RagCitation {
  label: string;
  url: string;
  vigencia: {
    desde: string | null;
    hasta: string | null;
  };
}

export interface RagSearchResult {
  id_chunk: string;
  score: number;
  text: string;
  meta: RagResultMeta;
  citation: RagCitation;
}

export interface RagSearchResponse {
  query: string;
  asOf: string;
  mode: RagSearchMode;
  filters: Record<string, unknown>;
  results: RagSearchResult[];
  stats: {
    topK: number;
    returned: number;
    qdrantTimeMs: number;
    embedTimeMs: number;
  };
}

export interface RagUsedCitation {
  id_chunk: string;
  id_unidad: string | null;
  id_norma: string | null;
  label: string;
  score: number;
  territorio: RagResultTerritorio;
  vigencia: {
    desde: string | null;
    hasta: string | null;
  };
  url_html_consolidada: string | null;
  url_eli: string | null;
  excerpt: string;
}

export interface RagAnswerResponse {
  query: string;
  asOf: string;
  mode: RagSearchMode;
  filters: Record<string, unknown>;
  answer: string;
  usedCitations: RagUsedCitation[];
  stats: {
    topK: number;
    returned: number;
    qdrantTimeMs: number;
    embedTimeMs: number;
    llmTimeMs: number;
    hydratedUnidades: number;
  };
  debug?: {
    llmFallback?: boolean;
    llmError?: string | null;
    retrieved?: Array<{
      id_chunk: string;
      id_unidad: string | null;
      score: number;
      id_norma: string | null;
      unidad_ref: string | null;
    }>;
  };
}

export interface RagUnidadResponse {
  id_unidad: string;
  id_norma: string;
  unidad_tipo: string;
  unidad_ref: string;
  titulo: string | null;
  texto_plano: string;
  territorio: {
    codigo: string;
    tipo: string;
    nombre: string;
  };
  fecha_vigencia_desde: string | null;
  fecha_vigencia_hasta: string | null;
  url_html_consolidada: string | null;
  url_eli: string | null;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  citations?: RagUsedCitation[];
}

export interface CcaaOption {
  codigo: string;
  nombre: string;
}

export interface CcaaCatalogResponse {
  items: CcaaOption[];
}
