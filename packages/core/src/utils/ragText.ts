import { XMLParser } from "fast-xml-parser";
import { sha256 } from "./hash";
import { buildChunkId } from "./ids";

export type ChunkMethod = "recursive" | "simple";
export type TextExtractor = "fastxml" | "xpath";

export interface ChunkingConfig {
  method: ChunkMethod;
  chunk_size: number;
  overlap: number;
}

export interface ChunkTextResult {
  chunk_index: number;
  texto: string;
  texto_hash: string;
  id_chunk: string;
}

const BLOCK_TAGS = new Set([
  "p",
  "li",
  "blockquote",
  "titulo",
  "epigrafe",
  "articulo",
  "apartado",
  "version",
  "parrafo",
  "parrafo_2",
]);

function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function normalizePlainText(input: string): string {
  const decoded = decodeEntities(input)
    .replace(/\r/g, "")
    .replace(/\u00A0/g, " ");

  const withCollapsedWhitespace = decoded
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ");

  const paragraphs = withCollapsedWhitespace
    .split(/\n{2,}/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return paragraphs.join("\n\n");
}

function regexExtractText(xml: string): string {
  const withBreaks = xml
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|blockquote|titulo|epigrafe|apartado|articulo|version)>/gi, "\n\n");

  const noTags = withBreaks.replace(/<[^>]+>/g, " ");
  return normalizePlainText(noTags);
}

function fastXmlExtractText(xml: string): string {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    trimValues: false,
    parseTagValue: false,
    preserveOrder: true,
    textNodeName: "#text",
  });

  const parsed = parser.parse(xml) as unknown;
  const pieces: string[] = [];

  function walk(nodes: unknown): void {
    if (!Array.isArray(nodes)) {
      return;
    }

    for (const node of nodes) {
      if (!node || typeof node !== "object") {
        continue;
      }

      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        const lowerKey = key.toLowerCase();

        if (key === ":@" || key === "#comment") {
          continue;
        }

        if (key === "#text" && typeof value === "string") {
          pieces.push(value);
          continue;
        }

        if ((key === "#cdata" || key === "__cdata") && typeof value === "string") {
          pieces.push(value);
          continue;
        }

        if (Array.isArray(value)) {
          walk(value);
          if (BLOCK_TAGS.has(lowerKey)) {
            pieces.push("\n\n");
          }
          continue;
        }

        if (typeof value === "string") {
          pieces.push(value);
          if (BLOCK_TAGS.has(lowerKey)) {
            pieces.push("\n\n");
          }
        }
      }
    }
  }

  walk(parsed);
  return normalizePlainText(pieces.join(" "));
}

export function extractPlainTextFromXml(xml: string, extractor: TextExtractor): string {
  if (extractor === "xpath") {
    return regexExtractText(xml);
  }

  try {
    return fastXmlExtractText(xml);
  } catch {
    return regexExtractText(xml);
  }
}

export function estimateTokensByChars(text: string): number {
  if (!text) {
    return 0;
  }
  return Math.max(1, Math.ceil(text.length / 4));
}

function splitSimple(text: string, chunkSize: number, overlap: number): string[] {
  if (!text) {
    return [];
  }

  const safeChunkSize = Math.max(1, chunkSize);
  const safeOverlap = Math.max(0, Math.min(overlap, safeChunkSize - 1));
  const step = Math.max(1, safeChunkSize - safeOverlap);

  const chunks: string[] = [];
  for (let start = 0; start < text.length; start += step) {
    const chunk = text.slice(start, start + safeChunkSize).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }
  }

  return chunks;
}

function applyOverlap(chunks: string[], overlap: number): string[] {
  if (chunks.length <= 1 || overlap <= 0) {
    return chunks;
  }

  const result: string[] = [chunks[0]];

  for (let index = 1; index < chunks.length; index += 1) {
    const previous = chunks[index - 1];
    const current = chunks[index];

    const prefix = previous.slice(Math.max(0, previous.length - overlap)).trim();
    const merged = prefix ? `${prefix}\n${current}` : current;
    result.push(merged.trim());
  }

  return result;
}

function splitRecursive(text: string, chunkSize: number, overlap: number): string[] {
  if (!text) {
    return [];
  }

  const paragraphs = text.split(/\n\n+/).map((part) => part.trim()).filter(Boolean);
  const baseChunks: string[] = [];

  let current = "";

  for (const paragraph of paragraphs) {
    if (paragraph.length > chunkSize) {
      if (current.length > 0) {
        baseChunks.push(current.trim());
        current = "";
      }

      baseChunks.push(...splitSimple(paragraph, chunkSize, 0));
      continue;
    }

    const candidate = current.length === 0 ? paragraph : `${current}\n\n${paragraph}`;
    if (candidate.length > chunkSize && current.length > 0) {
      baseChunks.push(current.trim());
      current = paragraph;
      continue;
    }

    current = candidate;
  }

  if (current.length > 0) {
    baseChunks.push(current.trim());
  }

  return applyOverlap(baseChunks, overlap);
}

export function splitTextIntoChunks(text: string, config: ChunkingConfig): string[] {
  if (config.method === "simple") {
    return splitSimple(text, config.chunk_size, config.overlap);
  }

  return splitRecursive(text, config.chunk_size, config.overlap);
}

export function buildVersionChunks(input: {
  id_version: string;
  texto_plano: string;
  chunking: ChunkingConfig;
}): ChunkTextResult[] {
  const chunks = splitTextIntoChunks(input.texto_plano, input.chunking);

  return chunks.map((texto, chunkIndex) => {
    const textoHash = sha256(texto);

    return {
      chunk_index: chunkIndex,
      texto,
      texto_hash: textoHash,
      id_chunk: buildChunkId({
        idVersion: input.id_version,
        chunkIndex,
        textoHash,
      }),
    };
  });
}
