import { XMLParser } from "fast-xml-parser";
import type { BloqueIndiceNormalized } from "../types";
import { parseBoeDate } from "./dates";

export interface ParsedIndice {
  bloques: BloqueIndiceNormalized[];
  fecha_actualizacion_indice: Date | null;
  fecha_actualizacion_indice_raw: string | null;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  trimValues: true,
  parseTagValue: false,
});

function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function parseBlockNode(rawNode: Record<string, unknown>): BloqueIndiceNormalized | null {
  const idFromChild = typeof rawNode.id === "string" ? rawNode.id : null;
  const idFromAttr = typeof rawNode["@_id"] === "string" ? (rawNode["@_id"] as string) : null;
  const id_bloque = idFromChild ?? idFromAttr;
  if (!id_bloque) {
    return null;
  }

  const fechaRaw =
    typeof rawNode.fecha_actualizacion === "string"
      ? (rawNode.fecha_actualizacion as string)
      : null;

  return {
    id_bloque,
    tipo:
      typeof rawNode.tipo === "string"
        ? rawNode.tipo
        : typeof rawNode["@_tipo"] === "string"
          ? (rawNode["@_tipo"] as string)
          : null,
    titulo_bloque:
      typeof rawNode.titulo === "string"
        ? (rawNode.titulo as string)
        : typeof rawNode["@_titulo"] === "string"
          ? (rawNode["@_titulo"] as string)
          : null,
    fecha_actualizacion_bloque: parseBoeDate(fechaRaw),
    fecha_actualizacion_bloque_raw: fechaRaw,
    url_bloque: typeof rawNode.url === "string" ? rawNode.url : null,
  };
}

export function parseIndiceXml(xml: string): ParsedIndice {
  const parsed = xmlParser.parse(xml) as Record<string, unknown>;

  const response =
    typeof parsed.response === "object" && parsed.response !== null
      ? (parsed.response as Record<string, unknown>)
      : parsed;

  const status =
    typeof response.status === "object" && response.status !== null
      ? (response.status as Record<string, unknown>)
      : null;

  const statusCode = status && typeof status.code === "string" ? status.code : "";
  if (statusCode && statusCode !== "200") {
    const statusText = status && typeof status.text === "string" ? status.text : "";
    throw new Error(`Indice API error ${statusCode}: ${statusText}`);
  }

  const dataNode =
    typeof response.data === "object" && response.data !== null
      ? (response.data as Record<string, unknown> | Array<Record<string, unknown>>)
      : null;

  let rawBloques: Record<string, unknown>[] = [];

  if (Array.isArray(dataNode)) {
    for (const entry of dataNode) {
      if (entry && typeof entry === "object" && "bloque" in entry) {
        rawBloques = rawBloques.concat(toArray((entry as Record<string, unknown>).bloque as any));
      }
    }
  } else if (dataNode && "bloque" in dataNode) {
    rawBloques = toArray((dataNode as Record<string, unknown>).bloque as any);
  }

  const bloques = rawBloques
    .map((node) => parseBlockNode(node))
    .filter((node): node is BloqueIndiceNormalized => node !== null);

  const maxRaw = bloques
    .map((bloque) => bloque.fecha_actualizacion_bloque_raw)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;

  return {
    bloques,
    fecha_actualizacion_indice_raw: maxRaw,
    fecha_actualizacion_indice: parseBoeDate(maxRaw),
  };
}
