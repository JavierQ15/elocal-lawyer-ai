import { deterministicId, sha256 } from "../utils/hash";
import type { UnidadTipo } from "./contracts";

export interface TextBlock {
  id_bloque: string;
  titulo_bloque: string | null;
  texto_plano: string;
  order: number;
}

export interface FilterDecision {
  keep: boolean;
  unidad_tipo: UnidadTipo;
  reason: string;
}

const SPACES_RE = /[ \t]+/g;
const MULTI_BREAKS_RE = /\n{3,}/g;
const ARTICULO_SHORT_HEADER_RE = /^art[íi]culo\s+\d+$/i;
const ARTICULO_TITLE_HEADER_RE = /^art[íi]culo\s+\d+\.\s+.+$/i;
const DISPOSICION_SHORT_HEADERS: Record<string, RegExp> = {
  DISPOSICION_ADICIONAL: /^disposici[oó]n\s+adicional\s+[^.\n]+$/i,
  DISPOSICION_TRANSITORIA: /^disposici[oó]n\s+transitoria\s+[^.\n]+$/i,
  DISPOSICION_FINAL: /^disposici[oó]n\s+(?:final|derogatoria)\s+[^.\n]+$/i,
};
const DISPOSICION_TITLE_HEADERS: Record<string, RegExp> = {
  DISPOSICION_ADICIONAL: /^disposici[oó]n\s+adicional\s+[^.\n]+\.\s+.+$/i,
  DISPOSICION_TRANSITORIA: /^disposici[oó]n\s+transitoria\s+[^.\n]+\.\s+.+$/i,
  DISPOSICION_FINAL: /^disposici[oó]n\s+(?:final|derogatoria)\s+[^.\n]+\.\s+.+$/i,
};
const APARTADO_RE = /^\d+\.\s+\S+/;
const INCISO_RE = /^[a-z]\)\s+\S+/i;

function normalizeInline(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(SPACES_RE, " ")
    .trim();
}

function normalizeHeadingOnlyLines(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u00A0/g, " ")
    .split("\n")
    .map((line) => line.replace(SPACES_RE, " ").trim())
    .filter((line) => line.length > 0);
}

function isHeadingLine(unidadTipo: UnidadTipo, line: string): boolean {
  if (unidadTipo === "ARTICULO") {
    return ARTICULO_SHORT_HEADER_RE.test(line) || ARTICULO_TITLE_HEADER_RE.test(line);
  }

  const shortHeader = DISPOSICION_SHORT_HEADERS[unidadTipo];
  const titleHeader = DISPOSICION_TITLE_HEADERS[unidadTipo];

  if (!shortHeader || !titleHeader) {
    return false;
  }

  return shortHeader.test(line) || titleHeader.test(line);
}

export function isHeadingOnlyUnidad(unidadTipo: UnidadTipo, textoPlano: string): boolean {
  const isEligibleTipo =
    unidadTipo === "ARTICULO" ||
    unidadTipo === "DISPOSICION_ADICIONAL" ||
    unidadTipo === "DISPOSICION_TRANSITORIA" ||
    unidadTipo === "DISPOSICION_FINAL";

  if (!isEligibleTipo) {
    return false;
  }

  const lines = normalizeHeadingOnlyLines(textoPlano);
  if (lines.length === 0) {
    return false;
  }

  if (lines.some((line) => APARTADO_RE.test(line) || INCISO_RE.test(line))) {
    return false;
  }

  const remaining = lines.filter((line) => !isHeadingLine(unidadTipo, line)).join("\n").trim();
  return remaining.length < 120;
}

export function normalizeSemanticText(text: string): string {
  return normalizeInline(text).replace(MULTI_BREAKS_RE, "\n\n").trim();
}

export function buildTextoHash(textoPlano: string): string {
  return sha256(normalizeSemanticText(textoPlano));
}

export function composeSemanticUnitText(input: {
  header?: string | null;
  blocks: TextBlock[];
}): string {
  const parts: string[] = [];
  const sortedBlocks = [...input.blocks].sort((a, b) => a.order - b.order);

  const header = normalizeInline(input.header ?? "");
  if (header.length > 0) {
    parts.push(header);
  }

  for (const block of sortedBlocks) {
    const text = normalizeInline(block.texto_plano);
    if (text.length === 0) {
      continue;
    }

    const previous = parts[parts.length - 1] ?? "";
    if (text === previous) {
      continue;
    }

    if (previous.length > 0 && previous.includes(text)) {
      continue;
    }

    parts.push(text);
  }

  return normalizeSemanticText(parts.join("\n\n"));
}

export function deriveUnidadRef(unidadTipo: UnidadTipo, titleOrText: string, fallback: string): string {
  const source = normalizeInline(titleOrText);

  if (unidadTipo === "ARTICULO") {
    const match = source.match(/art[íi]culo\s+([^\.\n]+)/i);
    if (match) {
      return `Art. ${match[1].trim()}`;
    }
  }

  if (unidadTipo === "DISPOSICION_ADICIONAL") {
    const match = source.match(/disposici[oó]n\s+adicional\s+([^\.\n]+)/i);
    if (match) {
      return `Disp. adicional ${match[1].trim()}`;
    }
  }

  if (unidadTipo === "DISPOSICION_TRANSITORIA") {
    const match = source.match(/disposici[oó]n\s+transitoria\s+([^\.\n]+)/i);
    if (match) {
      return `Disp. transitoria ${match[1].trim()}`;
    }
  }

  if (unidadTipo === "DISPOSICION_FINAL") {
    const match = source.match(/disposici[oó]n\s+(?:final|derogatoria)\s+([^\.\n]+)/i);
    if (match) {
      return `Disp. final ${match[1].trim()}`;
    }
  }

  if (unidadTipo === "ANEXO") {
    const match = source.match(/anexo\s+([^\.\n]+)/i);
    if (match) {
      return `Anexo ${match[1].trim()}`;
    }
    return "Anexo";
  }

  if (unidadTipo === "PREAMBULO") {
    return "Preámbulo";
  }

  return fallback;
}

export function shouldKeepSemanticUnit(input: {
  unidad_tipo: UnidadTipo;
  texto_plano: string;
  hasChildrenWithContent: boolean;
  looksNoise: boolean;
}): FilterDecision {
  const nChars = normalizeSemanticText(input.texto_plano).length;

  if (nChars === 0) {
    return {
      keep: false,
      unidad_tipo: input.unidad_tipo,
      reason: "empty_text",
    };
  }

  if (nChars < 200 && !input.hasChildrenWithContent) {
    return {
      keep: false,
      unidad_tipo: input.unidad_tipo,
      reason: "too_short",
    };
  }

  if (input.looksNoise) {
    if (nChars >= 500) {
      return {
        keep: true,
        unidad_tipo: "OTROS",
        reason: "noise_promoted_to_otros",
      };
    }

    return {
      keep: false,
      unidad_tipo: input.unidad_tipo,
      reason: "noise_filtered",
    };
  }

  return {
    keep: true,
    unidad_tipo: input.unidad_tipo,
    reason: "ok",
  };
}

export function buildUnidadLineageKey(input: {
  id_norma: string;
  unidad_tipo: UnidadTipo;
  unidad_ref: string;
}): string {
  return deterministicId([input.id_norma, input.unidad_tipo, input.unidad_ref]);
}

export function buildUnidadId(input: {
  id_norma: string;
  unidad_tipo: UnidadTipo;
  unidad_ref: string;
  fecha_vigencia_desde: Date | null;
  id_norma_modificadora: string | null;
  texto_hash: string;
}): string {
  return deterministicId([
    input.id_norma,
    input.unidad_tipo,
    input.unidad_ref,
    input.fecha_vigencia_desde?.toISOString() ?? "",
    input.id_norma_modificadora ?? "",
    input.texto_hash,
  ]);
}
