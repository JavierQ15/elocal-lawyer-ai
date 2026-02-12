export type UnidadTipo =
  | "ARTICULO"
  | "DISPOSICION_ADICIONAL"
  | "DISPOSICION_TRANSITORIA"
  | "DISPOSICION_FINAL"
  | "ANEXO"
  | "PREAMBULO"
  | "OTROS";

export interface UnidadBloqueOrigen {
  id_bloque: string;
  tipo: string | null;
  titulo_bloque: string | null;
  n_chars: number;
}

export interface UnidadSource {
  metodo: "merge_bloques";
  bloques_origen: UnidadBloqueOrigen[];
  indice_hash: string;
  version_hashes: string[];
}

export interface UnidadTerritorio {
  tipo: "ESTATAL" | "AUTONOMICO";
  codigo: string;
  nombre: string;
}

export interface UnidadMetadata {
  rango_texto: string | null;
  ambito_texto: string | null;
  ambito_codigo: string | null;
  departamento_codigo: string | null;
  departamento_texto: string | null;
  territorio: UnidadTerritorio;
  url_html_consolidada: string | null;
  url_eli: string | null;
  tags: string[];
}

export interface UnidadQuality {
  is_heading_only: boolean;
  skip_retrieval: boolean;
  reason: "heading_only" | null;
}

export interface UnidadDoc {
  _id: string;
  id_unidad: string;
  id_norma: string;
  unidad_tipo: UnidadTipo;
  unidad_ref: string;
  titulo: string | null;
  orden: number;
  fecha_vigencia_desde: Date | null;
  fecha_vigencia_hasta: Date | null;
  fecha_publicacion_mod: Date | null;
  id_norma_modificadora: string | null;
  texto_plano: string;
  texto_hash: string;
  n_chars: number;
  source: UnidadSource;
  metadata: UnidadMetadata;
  quality?: UnidadQuality;
  lineage_key: string;
  created_at: Date;
  last_seen_at: Date;
  is_latest: boolean;
}

export interface ChunkSemanticoMetadata {
  id_norma: string;
  unidad_tipo: UnidadTipo;
  unidad_ref: string;
  titulo: string | null;
  ambito_texto: string | null;
  ambito_codigo: string | null;
  rango_texto: string | null;
  territorio: {
    tipo: "ESTATAL" | "AUTONOMICO";
    codigo: string;
    nombre: string;
  };
  departamento_codigo: string | null;
  departamento_texto: string | null;
  fecha_vigencia_desde: Date | null;
  fecha_vigencia_hasta: Date | null;
  url_html_consolidada: string | null;
  url_eli: string | null;
  tags: string[];
}

export interface ChunkSemanticoDoc {
  _id: string;
  id_unidad: string;
  id_norma: string;
  chunk_index: number;
  texto: string;
  texto_hash: string;
  chunking_hash: string;
  chunking: {
    method: "recursive" | "simple";
    chunk_size: number;
    overlap: number;
  };
  metadata: ChunkSemanticoMetadata;
  created_at: Date;
  last_seen_at: Date;
}

export interface TerritorioCatalogDoc {
  _id: string;
  codigo: string;
  nombre: string;
  tipo: "ESTATAL" | "AUTONOMICO";
  departamento_codigo: string | null;
  created_at: Date;
  last_seen_at: Date;
}
