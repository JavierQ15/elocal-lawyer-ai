import { XMLBuilder, XMLParser } from "fast-xml-parser";
import { parseBoeDate } from "./dates";
import type { BloqueParsed, VersionBloqueParsed } from "../types";

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  trimValues: false,
  parseTagValue: false,
});

const xmlBuilder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  suppressEmptyNode: false,
  format: false,
});

function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function toRecordArray(value: unknown): Record<string, unknown>[] {
  const candidates = toArray(value as Record<string, unknown> | Record<string, unknown>[] | undefined);
  return candidates.filter(
    (candidate): candidate is Record<string, unknown> =>
      typeof candidate === "object" && candidate !== null,
  );
}

function extractVersionSnippets(xml: string): string[] {
  const bloqueMatch = xml.match(/<bloque\b[\s\S]*?<\/bloque>/i);
  if (!bloqueMatch) {
    return [];
  }

  const snippets = bloqueMatch[0].match(/<version\b[\s\S]*?<\/version>/gi);
  return snippets ?? [];
}

function buildVersionXmlFallback(versionNode: Record<string, unknown>): string {
  return xmlBuilder.build({ version: versionNode });
}

function pickString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseVersionNode(
  versionNode: Record<string, unknown>,
  rawVersionXml: string,
): VersionBloqueParsed {
  const id_norma_modificadora =
    pickString(versionNode.id_norma) ?? pickString(versionNode["@_id_norma"]);

  const fechaVigenciaRaw =
    pickString(versionNode.fecha_vigencia) ?? pickString(versionNode["@_fecha_vigencia"]);

  const fechaPublicacionRaw =
    pickString(versionNode.fecha_publicacion) ??
    pickString(versionNode["@_fecha_publicacion"]) ??
    pickString(versionNode.fecha_publicacion_mod);

  return {
    id_norma_modificadora,
    fecha_vigencia_desde_raw: fechaVigenciaRaw,
    fecha_vigencia_desde: parseBoeDate(fechaVigenciaRaw),
    fecha_publicacion_mod_raw: fechaPublicacionRaw,
    fecha_publicacion_mod: parseBoeDate(fechaPublicacionRaw),
    raw_version_xml: rawVersionXml,
  };
}

export function parseBloqueXml(xml: string): BloqueParsed {
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
    throw new Error(`Bloque API error ${statusCode}: ${statusText}`);
  }

  const dataNode =
    typeof response.data === "object" && response.data !== null
      ? (response.data as Record<string, unknown>)
      : null;

  const bloqueNode =
    dataNode && typeof dataNode.bloque === "object" && dataNode.bloque !== null
      ? (dataNode.bloque as Record<string, unknown>)
      : null;

  if (!bloqueNode) {
    return {
      id_bloque: null,
      tipo: null,
      titulo_bloque: null,
      versiones: [],
    };
  }

  const rawVersionSnippets = extractVersionSnippets(xml);
  const versionNodes = toRecordArray(bloqueNode.version);

  const versiones: VersionBloqueParsed[] = versionNodes.map((versionNode, index) => {
    const rawVersionXml = rawVersionSnippets[index] ?? buildVersionXmlFallback(versionNode);
    return parseVersionNode(versionNode, rawVersionXml);
  });

  return {
    id_bloque: pickString(bloqueNode.id) ?? pickString(bloqueNode["@_id"]),
    tipo: pickString(bloqueNode.tipo) ?? pickString(bloqueNode["@_tipo"]),
    titulo_bloque: pickString(bloqueNode.titulo) ?? pickString(bloqueNode["@_titulo"]),
    versiones,
  };
}
