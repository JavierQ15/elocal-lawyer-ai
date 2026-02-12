import type { BloqueIndiceNormalized } from "../types";
import type { UnidadTipo } from "./contracts";

export type SemanticNodeKind = "UNIT_ROOT" | "HEADER" | "NOISE" | "OTHER";

export interface SemanticClassification {
  unidad_tipo: UnidadTipo;
  kind: SemanticNodeKind;
  level: number;
}

const RE_ARTICULO = /^art[íi]culo\b/i;
const RE_DISP_ADICIONAL = /^disposici[oó]n\s+adicional\b/i;
const RE_DISP_TRANSITORIA = /^disposici[oó]n\s+transitoria\b/i;
const RE_DISP_FINAL = /^disposici[oó]n\s+final\b/i;
const RE_DISP_DEROGATORIA = /^disposici[oó]n\s+derogatoria\b/i;
const RE_ANEXO = /^anexo\b/i;
const RE_TITULO = /^t[íi]tulo\b/i;
const RE_CAPITULO = /^cap[íi]tulo\b/i;
const RE_SECCION = /^secci[oó]n\b/i;
const RE_NOTE = /(nota|advertencia|r[úu]brica)/i;

function normalize(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function isTitleId(idBloque: string): boolean {
  return /^t[pivxlcdm-]+$/i.test(idBloque);
}

function isChapterId(idBloque: string): boolean {
  return /^c[ivxlcdm-]+$/i.test(idBloque);
}

function isSectionId(idBloque: string): boolean {
  return /^s[0-9ivxlcdm-]+$/i.test(idBloque);
}

function isArticleId(idBloque: string): boolean {
  return /^a\d/i.test(idBloque) || /^ar-\d+/i.test(idBloque);
}

function isAdditionalDispositionId(idBloque: string): boolean {
  return /^da(?:-|$)/i.test(idBloque);
}

function isTransitionalDispositionId(idBloque: string): boolean {
  return /^dt(?:-|$)/i.test(idBloque);
}

function isFinalDispositionId(idBloque: string): boolean {
  return /^df(?:-|$)/i.test(idBloque) || /^dd(?:-|$)/i.test(idBloque);
}

function isAnnexId(idBloque: string): boolean {
  return /^an(?:-|$)/i.test(idBloque) || /^ax(?:-|$)/i.test(idBloque);
}

function isNoiseId(idBloque: string): boolean {
  return idBloque === "fi" || idBloque === "no";
}

function inferByTitle(title: string): UnidadTipo | null {
  if (!title) {
    return null;
  }

  if (RE_ARTICULO.test(title)) {
    return "ARTICULO";
  }
  if (RE_DISP_ADICIONAL.test(title)) {
    return "DISPOSICION_ADICIONAL";
  }
  if (RE_DISP_TRANSITORIA.test(title)) {
    return "DISPOSICION_TRANSITORIA";
  }
  if (RE_DISP_FINAL.test(title) || RE_DISP_DEROGATORIA.test(title)) {
    return "DISPOSICION_FINAL";
  }
  if (RE_ANEXO.test(title)) {
    return "ANEXO";
  }
  if (/preambulo/i.test(title) || /preámbulo/i.test(title)) {
    return "PREAMBULO";
  }

  return null;
}

function inferUnidadTipo(block: BloqueIndiceNormalized): UnidadTipo {
  const idBloque = normalize(block.id_bloque).toLowerCase();
  const titulo = normalize(block.titulo_bloque);
  const tipo = normalize(block.tipo).toLowerCase();

  if (tipo.includes("preambulo") || idBloque === "pr") {
    return "PREAMBULO";
  }

  const fromTitle = inferByTitle(titulo);
  if (fromTitle) {
    return fromTitle;
  }

  if (isArticleId(idBloque)) {
    return "ARTICULO";
  }
  if (isAdditionalDispositionId(idBloque)) {
    return "DISPOSICION_ADICIONAL";
  }
  if (isTransitionalDispositionId(idBloque)) {
    return "DISPOSICION_TRANSITORIA";
  }
  if (isFinalDispositionId(idBloque)) {
    return "DISPOSICION_FINAL";
  }
  if (isAnnexId(idBloque)) {
    return "ANEXO";
  }

  return "OTROS";
}

export function classifyIndiceBlock(block: BloqueIndiceNormalized): SemanticClassification {
  const idBloque = normalize(block.id_bloque).toLowerCase();
  const titulo = normalize(block.titulo_bloque);
  const tipo = normalize(block.tipo).toLowerCase();
  const unidad_tipo = inferUnidadTipo(block);

  if (isNoiseId(idBloque) || RE_NOTE.test(titulo)) {
    return {
      unidad_tipo,
      kind: "NOISE",
      level: 6,
    };
  }

  if (unidad_tipo === "PREAMBULO") {
    return {
      unidad_tipo,
      kind: "UNIT_ROOT",
      level: 1,
    };
  }

  if (
    tipo.includes("encabezado") ||
    RE_TITULO.test(titulo) ||
    RE_CAPITULO.test(titulo) ||
    RE_SECCION.test(titulo) ||
    isTitleId(idBloque) ||
    isChapterId(idBloque) ||
    isSectionId(idBloque)
  ) {
    if (RE_CAPITULO.test(titulo) || isChapterId(idBloque)) {
      return {
        unidad_tipo: "OTROS",
        kind: "HEADER",
        level: 2,
      };
    }

    if (RE_SECCION.test(titulo) || isSectionId(idBloque)) {
      return {
        unidad_tipo: "OTROS",
        kind: "HEADER",
        level: 3,
      };
    }

    return {
      unidad_tipo: "OTROS",
      kind: "HEADER",
      level: 1,
    };
  }

  if (unidad_tipo === "ARTICULO") {
    return {
      unidad_tipo,
      kind: "UNIT_ROOT",
      level: 4,
    };
  }

  if (
    unidad_tipo === "DISPOSICION_ADICIONAL" ||
    unidad_tipo === "DISPOSICION_TRANSITORIA" ||
    unidad_tipo === "DISPOSICION_FINAL" ||
    unidad_tipo === "ANEXO"
  ) {
    return {
      unidad_tipo,
      kind: "UNIT_ROOT",
      level: 4,
    };
  }

  if (tipo.includes("precepto")) {
    return {
      unidad_tipo,
      kind: "UNIT_ROOT",
      level: 5,
    };
  }

  return {
    unidad_tipo,
    kind: "OTHER",
    level: 5,
  };
}
