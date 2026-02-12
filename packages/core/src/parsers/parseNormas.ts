import { parseBoeDate, parseBoeDateTime } from "./dates";
import type { DiscoverResponse, NormaNormalized, NormaRawItem } from "../types";
import { normalizeTerritorioFromRaw } from "../utils/territorio";

function getNestedText(value: unknown): string | null {
  if (!value) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object" && value !== null) {
    const maybeTexto = (value as Record<string, unknown>).texto;
    if (typeof maybeTexto === "string") {
      return maybeTexto;
    }
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function parseNormasResponse(payload: DiscoverResponse): NormaNormalized[] {
  if (!Array.isArray(payload.data)) {
    return [];
  }

  const results: NormaNormalized[] = [];

  for (const rawItem of payload.data) {
    const item = asRecord(rawItem) as NormaRawItem;
    const idNorma = typeof item.identificador === "string" ? item.identificador : null;
    if (!idNorma) {
      continue;
    }

    const rawItemJson = asRecord(rawItem);
    const territorioNormalized = normalizeTerritorioFromRaw(rawItemJson);

    const normalized: NormaNormalized = {
      id_norma: idNorma,
      titulo: typeof item.titulo === "string" ? item.titulo : null,
      rango_texto: getNestedText(item.rango),
      departamento_texto: getNestedText(item.departamento),
      ambito_texto: getNestedText(item.ambito),
      ambito_codigo: territorioNormalized.ambito_codigo,
      departamento_codigo: territorioNormalized.departamento_codigo,
      territorio: territorioNormalized.territorio,
      fecha_actualizacion: parseBoeDateTime(
        typeof item.fecha_actualizacion === "string" ? item.fecha_actualizacion : null,
      ),
      fecha_publicacion: parseBoeDate(
        typeof item.fecha_publicacion === "string" ? item.fecha_publicacion : null,
      ),
      fecha_disposicion: parseBoeDate(
        typeof item.fecha_disposicion === "string" ? item.fecha_disposicion : null,
      ),
      url_html_consolidada:
        typeof item.url_html_consolidada === "string" ? item.url_html_consolidada : null,
      raw_item_json: rawItemJson,
    };

    results.push(normalized);
  }

  return results;
}
