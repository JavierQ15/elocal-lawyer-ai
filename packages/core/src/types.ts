import type { TerritorioNormalized } from "./utils/territorio";

export interface BloeAmbientText {
  codigo?: string;
  texto?: string;
}

export interface NormaRawItem {
  [key: string]: unknown;
  identificador?: string;
  titulo?: string;
  fecha_actualizacion?: string;
  fecha_publicacion?: string;
  fecha_disposicion?: string;
  url_html_consolidada?: string;
  rango?: BloeAmbientText | string;
  departamento?: BloeAmbientText | string;
  ambito?: BloeAmbientText | string;
}

export interface NormaNormalized {
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
}

export interface BloqueIndiceNormalized {
  id_bloque: string;
  tipo: string | null;
  titulo_bloque: string | null;
  fecha_actualizacion_bloque: Date | null;
  fecha_actualizacion_bloque_raw: string | null;
  url_bloque: string | null;
}

export interface VersionBloqueParsed {
  id_norma_modificadora: string | null;
  fecha_vigencia_desde: Date | null;
  fecha_vigencia_desde_raw: string | null;
  fecha_publicacion_mod: Date | null;
  fecha_publicacion_mod_raw: string | null;
  raw_version_xml: string;
}

export interface BloqueParsed {
  id_bloque: string | null;
  tipo: string | null;
  titulo_bloque: string | null;
  versiones: VersionBloqueParsed[];
}

export interface DiscoverFilters {
  from?: string;
  to?: string;
  offset?: number;
  limit?: number;
  query?: string;
}

export interface DiscoverResponse {
  status?: {
    code?: string;
    text?: string;
  };
  data?: unknown[];
}
