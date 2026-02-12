import pLimit from "p-limit";
import { Command } from "commander";
import type { Filter } from "mongodb";
import type { AppServices } from "../services";
import type { ChunkSemanticoDoc, UnidadDoc } from "@boe/core/semantic/contracts";
import { buildSemanticChunkId } from "@boe/core/utils/ids";
import { deterministicId } from "@boe/core/utils/hash";
import { normalizeCliDateToBoe, parseBoeDate } from "@boe/core/parsers/dates";
import { splitTextIntoChunks } from "@boe/core/utils/ragText";

export interface BuildChunksOptions {
  from?: string;
  to?: string;
  all?: boolean;
  onlyNorma?: string[];
  concurrency?: number;
  method?: "recursive" | "simple";
  chunkSize?: number;
  overlap?: number;
  failOnErrors?: boolean;
}

interface BuildChunksStats {
  unidadesSeen: number;
  unidadesSkippedQuality: number;
  unidadesFailed: number;
  generatedChunks: number;
  skippedHeadingOnlyChunks: number;
  chunksInserted: number;
  chunksExisting: number;
  chunksWithVigenciaHasta: number;
  staleChunksDeleted: number;
}

const CHUNK_SPACES_RE = /[ \t]+/g;
const APARTADO_RE = /(^|\n)\s*\d+\.\s+\S/;
const APARTADO_DASH_RE = /(^|\n)\s*\d+\s*[-â€“]\s+\S/;
const INCISO_RE = /(^|\n)\s*[a-z]\)\s+\S/i;

function parseOptionalInt(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid integer value: ${value}`);
  }
  return parsed;
}

function toDayStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function toDayEnd(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999),
  );
}

function normalizeChunkText(text: string): string {
  const normalized = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u00A0/g, " ");

  const lines = normalized.split("\n").map((line) => line.replace(CHUNK_SPACES_RE, " ").trim());
  const collapsed: string[] = [];

  for (const line of lines) {
    const previous = collapsed[collapsed.length - 1] ?? null;
    if (line.length === 0 && previous === "") {
      continue;
    }
    collapsed.push(line);
  }

  while (collapsed[0] === "") {
    collapsed.shift();
  }

  while (collapsed[collapsed.length - 1] === "") {
    collapsed.pop();
  }

  return collapsed.join("\n").trim();
}

function countLongSentences(normalizedChunk: string): number {
  const phrases = normalizedChunk
    .replace(/\n+/g, " ")
    .split(/[.!?]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  return phrases.filter((phrase) => phrase.length >= 35).length;
}

function normalizeHeadingRef(value: string): string {
  return value.replace(CHUNK_SPACES_RE, " ").trim().toLowerCase();
}

function isArticuloHeadingOnly(lines: string[]): boolean {
  if (lines.length !== 2) {
    return false;
  }

  const firstMatch = lines[0].match(/^art[Ã­i]culo\s+(.+)$/i);
  const secondMatch = lines[1].match(/^art[Ã­i]culo\s+(.+?)\.\s+.+$/i);

  if (!firstMatch || !secondMatch) {
    return false;
  }

  if (lines[0].includes(".")) {
    return false;
  }

  return normalizeHeadingRef(firstMatch[1]) === normalizeHeadingRef(secondMatch[1]);
}

function isDisposicionHeadingOnly(lines: string[]): boolean {
  if (lines.length !== 2) {
    return false;
  }

  const firstMatch = lines[0].match(/^disposici[oÃ³]n\s+(.+)$/i);
  const secondMatch = lines[1].match(/^disposici[oÃ³]n\s+(.+?)\.\s+.+$/i);

  if (!firstMatch || !secondMatch) {
    return false;
  }

  if (lines[0].includes(".")) {
    return false;
  }

  return normalizeHeadingRef(firstMatch[1]) === normalizeHeadingRef(secondMatch[1]);
}

export function isHeadingOnlyChunk(unidadTipo: UnidadDoc["unidad_tipo"], chunkText: string): boolean {
  const normalizedChunk = normalizeChunkText(chunkText);

  if (normalizedChunk.length === 0) {
    return false;
  }

  if (normalizedChunk.length >= 120) {
    return false;
  }

  if (
    APARTADO_RE.test(normalizedChunk) ||
    APARTADO_DASH_RE.test(normalizedChunk) ||
    INCISO_RE.test(normalizedChunk)
  ) {
    return false;
  }

  if (countLongSentences(normalizedChunk) > 2) {
    return false;
  }

  const nonEmptyLines = normalizedChunk.split("\n").filter((line) => line.length > 0);

  if (unidadTipo === "ARTICULO") {
    return isArticuloHeadingOnly(nonEmptyLines);
  }

  if (unidadTipo.startsWith("DISPOSICION_")) {
    return isDisposicionHeadingOnly(nonEmptyLines);
  }

  return false;
}

export async function runBuildChunks(
  services: AppServices,
  options: BuildChunksOptions,
): Promise<BuildChunksStats> {
  const stats: BuildChunksStats = {
    unidadesSeen: 0,
    unidadesSkippedQuality: 0,
    unidadesFailed: 0,
    generatedChunks: 0,
    skippedHeadingOnlyChunks: 0,
    chunksInserted: 0,
    chunksExisting: 0,
    chunksWithVigenciaHasta: 0,
    staleChunksDeleted: 0,
  };

  const fromBoe = normalizeCliDateToBoe(options.from);
  const toBoe = normalizeCliDateToBoe(options.to);

  const fromDate = fromBoe ? toDayStart(parseBoeDate(fromBoe) as Date) : undefined;
  const toDate = toBoe ? toDayEnd(parseBoeDate(toBoe) as Date) : undefined;

  const chunking = {
    method: options.method ?? services.config.chunkMethod,
    chunk_size: options.chunkSize ?? services.config.chunkSize,
    overlap: options.overlap ?? services.config.chunkOverlap,
  } as const;

  const chunkingHash = deterministicId([
    chunking.method,
    String(chunking.chunk_size),
    String(chunking.overlap),
  ]);

  const unidadesCollection = services.db.collection<UnidadDoc>("unidades");
  const chunksCollection = services.db.collection<ChunkSemanticoDoc>("chunks_semanticos");

  const query: Filter<UnidadDoc> = {};

  if (options.onlyNorma && options.onlyNorma.length > 0) {
    query.id_norma = { $in: options.onlyNorma };
  }

  if (!options.all && (fromDate || toDate)) {
    query.fecha_vigencia_desde = {} as { $gte?: Date; $lte?: Date };
    if (fromDate) {
      query.fecha_vigencia_desde.$gte = fromDate;
    }
    if (toDate) {
      query.fecha_vigencia_desde.$lte = toDate;
    }
  }

  const unidades = await unidadesCollection.find(query).toArray();
  const limiter = pLimit(options.concurrency ?? services.config.requestConcurrency);

  await Promise.all(
    unidades.map((unidad) =>
      limiter(async () => {
        stats.unidadesSeen += 1;

        try {
          if (unidad.quality?.skip_retrieval === true) {
            stats.unidadesSkippedQuality += 1;
            services.logger.info(
              {
                id_unidad: unidad.id_unidad,
                id_norma: unidad.id_norma,
                unidad_tipo: unidad.unidad_tipo,
                unidad_ref: unidad.unidad_ref,
                n_chars: unidad.n_chars,
              },
              "build-chunks skipped unidad by quality flag",
            );
            return;
          }

          const shouldKeepSingleArticuloChunk =
            unidad.unidad_tipo === "ARTICULO" &&
            unidad.n_chars <= chunking.chunk_size;
          const pieces = shouldKeepSingleArticuloChunk
            ? [unidad.texto_plano]
            : splitTextIntoChunks(unidad.texto_plano, chunking);
          const now = new Date();
          const keptChunkIds: string[] = [];

          for (const [chunkIndex, text] of pieces.entries()) {
            const chunkText = normalizeChunkText(text);
            if (chunkText.length === 0) {
              continue;
            }

            if (isHeadingOnlyChunk(unidad.unidad_tipo, chunkText)) {
              stats.skippedHeadingOnlyChunks += 1;
              continue;
            }

            stats.generatedChunks += 1;

            const chunkTextHash = deterministicId([chunkText]);
            const chunkId = buildSemanticChunkId({
              idUnidad: unidad.id_unidad,
              chunkingHash,
              chunkIndex,
              textoHash: chunkTextHash,
            });
            keptChunkIds.push(chunkId);
            stats.chunksWithVigenciaHasta += 1;

            if (services.dryRun) {
              const exists = await chunksCollection.countDocuments({ _id: chunkId }, { limit: 1 });
              if (exists > 0) {
                stats.chunksExisting += 1;
              } else {
                stats.chunksInserted += 1;
              }
              continue;
            }

            const result = await chunksCollection.updateOne(
              { _id: chunkId },
              {
                $set: {
                  id_unidad: unidad.id_unidad,
                  id_norma: unidad.id_norma,
                  chunk_index: chunkIndex,
                  texto: chunkText,
                  texto_hash: chunkTextHash,
                  chunking_hash: chunkingHash,
                  chunking,
                  metadata: {
                    id_norma: unidad.id_norma,
                    unidad_tipo: unidad.unidad_tipo,
                    unidad_ref: unidad.unidad_ref,
                    titulo: unidad.titulo,
                    ambito_texto: unidad.metadata.ambito_texto,
                    ambito_codigo: unidad.metadata.ambito_codigo,
                    rango_texto: unidad.metadata.rango_texto,
                    territorio: unidad.metadata.territorio,
                    departamento_codigo: unidad.metadata.departamento_codigo,
                    departamento_texto: unidad.metadata.departamento_texto,
                    fecha_vigencia_desde: unidad.fecha_vigencia_desde,
                    fecha_vigencia_hasta: unidad.fecha_vigencia_hasta ?? null,
                    url_html_consolidada: unidad.metadata.url_html_consolidada,
                    url_eli: unidad.metadata.url_eli,
                    tags: unidad.metadata.tags,
                  },
                  last_seen_at: now,
                },
                $setOnInsert: {
                  created_at: now,
                },
              },
              { upsert: true },
            );

            if (result.upsertedCount > 0) {
              stats.chunksInserted += 1;
            } else {
              stats.chunksExisting += 1;
            }
          }

          if (!services.dryRun) {
            const deleteFilter: Filter<ChunkSemanticoDoc> =
              keptChunkIds.length > 0
                ? {
                    id_unidad: unidad.id_unidad,
                    chunking_hash: chunkingHash,
                    _id: { $nin: keptChunkIds },
                  }
                : {
                    id_unidad: unidad.id_unidad,
                    chunking_hash: chunkingHash,
                  };

            const deleteResult = await chunksCollection.deleteMany(deleteFilter);
            stats.staleChunksDeleted += deleteResult.deletedCount;
          }
        } catch (error) {
          stats.unidadesFailed += 1;
          services.logger.error(
            {
              id_unidad: unidad.id_unidad,
              err: error instanceof Error ? error.message : String(error),
            },
            "build-chunks failed for unidad",
          );
        }
      }),
    ),
  );

  if (options.failOnErrors && stats.unidadesFailed > 0) {
    throw new Error(`build-chunks failed for ${stats.unidadesFailed} unidad(es)`);
  }

  const hasVigenciaHastaInGenerated = stats.generatedChunks === stats.chunksWithVigenciaHasta;
  services.logger.info(
    { stats, chunking, hasVigenciaHastaInGenerated },
    "build-chunks completed",
  );
  return stats;
}

export function registerBuildChunksCommand(
  program: Command,
  getServices: () => Promise<AppServices>,
): void {
  program
    .command("build-chunks")
    .description("Construye chunks semanticos desde unidades")
    .option("--from <date>", "Fecha inicio (YYYY-MM-DD) sobre fecha_vigencia_desde")
    .option("--to <date>", "Fecha fin (YYYY-MM-DD) sobre fecha_vigencia_desde")
    .option("--all", "Procesa todas las unidades")
    .option("--only-norma <ids...>", "Lista de id_norma")
    .option("--concurrency <number>", "Concurrencia", parseOptionalInt)
    .option("--method <method>", "Metodo de chunking: recursive|simple")
    .option("--chunk-size <number>", "Tamano de chunk", parseOptionalInt)
    .option("--overlap <number>", "Solape de chunk", parseOptionalInt)
    .option("--fail-on-errors", "Devuelve exit code != 0 si falla alguna unidad")
    .action(async (cmdOptions: BuildChunksOptions) => {
      const services = await getServices();
      await runBuildChunks(services, cmdOptions);
    });
}


