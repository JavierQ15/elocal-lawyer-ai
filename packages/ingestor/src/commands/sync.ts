import pLimit from "p-limit";
import { Command } from "commander";
import type { AppServices } from "../services";
import { runDiscover } from "./discover";
import { parseBloqueXml } from "@boe/core/parsers/parseBloque";
import { parseIndiceXml } from "@boe/core/parsers/parseIndice";
import { normalizeCliDateToBoe, parseBoeDate } from "@boe/core/parsers/dates";
import { buildIndiceId, buildVersionId } from "@boe/core/utils/ids";
import { sha256 } from "@boe/core/utils/hash";
import {
  buildVersionChunks,
  estimateTokensByChars,
  extractPlainTextFromXml,
} from "@boe/core/utils/ragText";

export interface SyncRunOptions {
  from?: string;
  to?: string;
  all?: boolean;
  normaId?: string[];
  maxNormas?: number;
  concurrency?: number;
  discoverFirst?: boolean;
  discoverLimit?: number;
  discoverBatchSize?: number;
  failOnErrors?: boolean;
}

interface SyncStats {
  normasProcessed: number;
  normasFailed: number;
  bloquesSeen: number;
  bloquesDirty: number;
  bloquesSkippedNoChange: number;
  bloquesSkippedNotFound: number;
  versionesInserted: number;
  versionesExisting: number;
  versionesTextGenerated: number;
  indicesInserted: number;
  chunksCreated: number;
  chunksSkippedExisting: number;
}

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

function pickLatestVersionId(
  versions: Array<{ idVersion: string; fechaVigencia: Date | null; fechaPublicacion: Date | null; order: number }>,
): string | null {
  if (versions.length === 0) {
    return null;
  }

  const sorted = [...versions].sort((a, b) => {
    const vigA = a.fechaVigencia ? a.fechaVigencia.getTime() : -1;
    const vigB = b.fechaVigencia ? b.fechaVigencia.getTime() : -1;
    if (vigA !== vigB) {
      return vigB - vigA;
    }

    const pubA = a.fechaPublicacion ? a.fechaPublicacion.getTime() : -1;
    const pubB = b.fechaPublicacion ? b.fechaPublicacion.getTime() : -1;
    if (pubA !== pubB) {
      return pubB - pubA;
    }

    return b.order - a.order;
  });

  return sorted[0]?.idVersion ?? null;
}

function isBloqueDirty(args: {
  existingFechaActualizacionRaw: string | null;
  incomingFechaActualizacionRaw: string | null;
  exists: boolean;
}): boolean {
  if (!args.exists) {
    return true;
  }

  if (!args.incomingFechaActualizacionRaw) {
    // No bloque-level timestamp available: fallback to hash comparison after download.
    return true;
  }

  if (!args.existingFechaActualizacionRaw) {
    return true;
  }

  return args.existingFechaActualizacionRaw !== args.incomingFechaActualizacionRaw;
}

function getHttpStatusCode(error: unknown): number | null {
  if (error && typeof error === "object") {
    const response = (error as { response?: { status?: unknown } }).response;
    if (response && typeof response.status === "number") {
      return response.status;
    }

    const status = (error as { status?: unknown }).status;
    if (typeof status === "number") {
      return status;
    }

    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") {
      const match = message.match(/status code\s+(\d{3})/i);
      if (match) {
        const parsed = Number.parseInt(match[1] ?? "", 10);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }
  }

  return null;
}

export async function runSync(services: AppServices, options: SyncRunOptions): Promise<SyncStats> {
  const stats: SyncStats = {
    normasProcessed: 0,
    normasFailed: 0,
    bloquesSeen: 0,
    bloquesDirty: 0,
    bloquesSkippedNoChange: 0,
    bloquesSkippedNotFound: 0,
    versionesInserted: 0,
    versionesExisting: 0,
    versionesTextGenerated: 0,
    indicesInserted: 0,
    chunksCreated: 0,
    chunksSkippedExisting: 0,
  };

  const fromBoe = normalizeCliDateToBoe(options.from);
  const toBoe = normalizeCliDateToBoe(options.to);

  let discoveredNormaIds: string[] = [];
  if (options.discoverFirst) {
    const discoverResult = await runDiscover(services, {
      from: options.from,
      to: options.to,
      limit: options.discoverLimit ?? -1,
      batchSize: options.discoverBatchSize,
    });
    discoveredNormaIds = discoverResult.normaIds;
  }

  const explicitIds = options.normaId ?? [];
  const idsFromDiscover = discoveredNormaIds;
  const selectedIds = explicitIds.length > 0 ? explicitIds : idsFromDiscover;

  const fromDate = fromBoe ? toDayStart(parseBoeDate(fromBoe) as Date) : undefined;
  const toDate = toBoe ? toDayEnd(parseBoeDate(toBoe) as Date) : undefined;

  const shouldUseAll =
    options.all ||
    (!fromDate && !toDate && selectedIds.length === 0 && !options.discoverFirst);

  const normas = await services.repos.normas.listForSync({
    from: shouldUseAll ? undefined : fromDate,
    to: shouldUseAll ? undefined : toDate,
    ids: selectedIds.length > 0 ? selectedIds : undefined,
    limit: options.maxNormas,
  });

  services.logger.info(
    {
      normaCount: normas.length,
      concurrency: options.concurrency ?? services.config.requestConcurrency,
      dryRun: services.dryRun,
      from: fromBoe,
      to: toBoe,
      shouldUseAll,
    },
    "Starting sync",
  );

  const limiter = pLimit(options.concurrency ?? services.config.requestConcurrency);

  const tasks = normas.map((norma) =>
    limiter(async () => {
      const start = new Date();
      await services.repos.syncState.markNormaStart(norma.id_norma, start, services.dryRun);

      try {
        const indiceXml = await services.client.fetchIndiceXml(norma.id_norma);
        const parsedIndice = parseIndiceXml(indiceXml);

        const indiceStore = await services.fsStore.saveIndice({
          idNorma: norma.id_norma,
          indiceFechaRaw: parsedIndice.fecha_actualizacion_indice_raw,
          rawXml: indiceXml,
          dryRun: services.dryRun,
        });

        const idIndice = buildIndiceId({
          idNorma: norma.id_norma,
          fechaActualizacionIndiceRaw:
            parsedIndice.fecha_actualizacion_indice_raw ??
            norma.fecha_actualizacion?.toISOString().slice(0, 10).replace(/-/g, "") ??
            null,
          hashXml: indiceStore.rawHash,
        });

        const now = new Date();

        const indexInserted = await services.repos.indices.insertIfMissing(
          {
            _id: idIndice,
            id_indice: idIndice,
            id_norma: norma.id_norma,
            fecha_actualizacion_indice: parsedIndice.fecha_actualizacion_indice,
            fecha_actualizacion_indice_raw: parsedIndice.fecha_actualizacion_indice_raw,
            hash_xml: indiceStore.rawHash,
            hash_xml_pretty: indiceStore.prettyHash,
            file_path: indiceStore.relativePath,
            is_latest: true,
            created_at: now,
            last_seen_at: now,
          },
          services.dryRun,
        );

        if (indexInserted) {
          stats.indicesInserted += 1;
        }

        await services.repos.indices.markLatestForNorma(norma.id_norma, idIndice, services.dryRun);

        for (const bloque of parsedIndice.bloques) {
          stats.bloquesSeen += 1;

          const existingBloque = await services.repos.bloques.findByNormaBloque(
            norma.id_norma,
            bloque.id_bloque,
          );

          await services.repos.bloques.upsertFromIndice(
            norma.id_norma,
            bloque,
            now,
            services.dryRun,
          );

          const dirty = isBloqueDirty({
            existingFechaActualizacionRaw: existingBloque?.fecha_actualizacion_bloque_raw ?? null,
            incomingFechaActualizacionRaw: bloque.fecha_actualizacion_bloque_raw,
            exists: Boolean(existingBloque),
          });

          if (!dirty) {
            stats.bloquesSkippedNoChange += 1;
            continue;
          }

          stats.bloquesDirty += 1;

          let bloqueXml: string;
          try {
            bloqueXml = await services.client.fetchBloqueXml(norma.id_norma, bloque.id_bloque);
          } catch (error) {
            const statusCode = getHttpStatusCode(error);
            if (statusCode === 404) {
              stats.bloquesSkippedNotFound += 1;
              services.logger.warn(
                {
                  id_norma: norma.id_norma,
                  id_bloque: bloque.id_bloque,
                  statusCode,
                },
                "Skipping bloque because BOE returned 404",
              );
              continue;
            }

            throw error;
          }

          if (services.config.storeRawSnapshots) {
            await services.fsStore.saveRawSnapshot(
              norma.id_norma,
              bloque.id_bloque,
              bloqueXml,
              new Date().toISOString().replace(/[:.]/g, ""),
              services.dryRun,
            );
          }

          const parsedBloque = parseBloqueXml(bloqueXml);

          await services.repos.bloques.updateBloqueMetadataFromBloqueXml(
            norma.id_norma,
            bloque.id_bloque,
            {
              tipo: parsedBloque.tipo,
              titulo_bloque: parsedBloque.titulo_bloque,
            },
            now,
            services.dryRun,
          );

          const latestCandidates: Array<{
            idVersion: string;
            fechaVigencia: Date | null;
            fechaPublicacion: Date | null;
            order: number;
          }> = [];

          parsedBloque.versiones.forEach((version, order) => {
            const hashXmlRaw = sha256(version.raw_version_xml);
            const idVersion = buildVersionId({
              idNorma: norma.id_norma,
              idBloque: bloque.id_bloque,
              fechaVigenciaDesdeRaw: version.fecha_vigencia_desde_raw,
              idNormaModificadora: version.id_norma_modificadora,
              hashXml: hashXmlRaw,
            });

            latestCandidates.push({
              idVersion,
              fechaVigencia: version.fecha_vigencia_desde,
              fechaPublicacion: version.fecha_publicacion_mod,
              order,
            });
          });

          for (const version of parsedBloque.versiones) {
            const hashXmlRaw = sha256(version.raw_version_xml);
            const idVersion = buildVersionId({
              idNorma: norma.id_norma,
              idBloque: bloque.id_bloque,
              fechaVigenciaDesdeRaw: version.fecha_vigencia_desde_raw,
              idNormaModificadora: version.id_norma_modificadora,
              hashXml: hashXmlRaw,
            });

            const existingVersion = await services.repos.versiones.findById(idVersion);
            if (existingVersion) {
              stats.versionesExisting += 1;
              await services.repos.versiones.touchLastSeen(idVersion, now, services.dryRun);
              stats.chunksSkippedExisting += await services.repos.chunks.touchByVersion(
                idVersion,
                now,
                services.dryRun,
              );
              continue;
            }

            const storedVersion = await services.fsStore.saveBloqueVersion({
              idNorma: norma.id_norma,
              idBloque: bloque.id_bloque,
              fechaVigenciaRaw: version.fecha_vigencia_desde_raw,
              fechaPublicacionRaw: version.fecha_publicacion_mod_raw,
              rawXml: version.raw_version_xml,
              dryRun: services.dryRun,
            });

            const textoPlano = extractPlainTextFromXml(
              version.raw_version_xml,
              services.config.textExtractor,
            );
            const textoHash = sha256(textoPlano);
            const nChars = textoPlano.length;
            const nTokensEst = estimateTokensByChars(textoPlano);

            const chunking = {
              method: services.config.chunkMethod,
              chunk_size: services.config.chunkSize,
              overlap: services.config.chunkOverlap,
            } as const;

            const insertResult = await services.repos.versiones.insertIfMissing(
              {
                _id: idVersion,
                id_version: idVersion,
                id_norma: norma.id_norma,
                id_bloque: bloque.id_bloque,
                fecha_vigencia_desde: version.fecha_vigencia_desde,
                fecha_vigencia_desde_raw: version.fecha_vigencia_desde_raw,
                fecha_publicacion_mod: version.fecha_publicacion_mod,
                fecha_publicacion_mod_raw: version.fecha_publicacion_mod_raw,
                id_norma_modificadora: version.id_norma_modificadora,
                hash_xml: hashXmlRaw,
                hash_xml_pretty: storedVersion.prettyHash,
                file_path: storedVersion.relativePath,
                is_latest: false,
                xml_raw: services.config.storeXmlInMongo ? version.raw_version_xml : null,
                xml_pretty: services.config.storePrettyXmlInMongo ? storedVersion.prettyXml : null,
                texto_plano: textoPlano,
                texto_hash: textoHash,
                n_chars: nChars,
                n_tokens_est: nTokensEst,
                chunking,
                created_at: now,
                last_seen_at: now,
              },
              services.dryRun,
            );

            if (insertResult.inserted) {
              stats.versionesInserted += 1;
              stats.versionesTextGenerated += 1;

              const chunks = buildVersionChunks({
                id_version: idVersion,
                texto_plano: textoPlano,
                chunking,
              });

              for (const chunk of chunks) {
                const chunkInserted = await services.repos.chunks.insertIfMissing(
                  {
                    _id: chunk.id_chunk,
                    id_version: idVersion,
                    id_norma: norma.id_norma,
                    id_bloque: bloque.id_bloque,
                    chunk_index: chunk.chunk_index,
                    texto: chunk.texto,
                    texto_hash: chunk.texto_hash,
                    metadata: {
                      titulo_norma: norma.titulo,
                      rango_texto: norma.rango_texto,
                      ambito_texto: norma.ambito_texto,
                      territorio: {
                        codigo: norma.territorio?.codigo ?? null,
                      },
                      departamento_texto: norma.departamento_texto,
                      fecha_vigencia_desde: version.fecha_vigencia_desde,
                      url_html_consolidada: norma.url_html_consolidada,
                      url_bloque: bloque.url_bloque,
                    },
                    created_at: now,
                    last_seen_at: now,
                  },
                  services.dryRun,
                );

                if (chunkInserted) {
                  stats.chunksCreated += 1;
                } else {
                  stats.chunksSkippedExisting += 1;
                }
              }
            } else {
              stats.versionesExisting += 1;
              stats.chunksSkippedExisting += await services.repos.chunks.touchByVersion(
                idVersion,
                now,
                services.dryRun,
              );
            }
          }

          const latestId = pickLatestVersionId(latestCandidates);
          if (latestId) {
            await services.repos.versiones.markLatestForBlock(
              norma.id_norma,
              bloque.id_bloque,
              latestId,
              services.dryRun,
            );
            await services.repos.bloques.setLatestVersionId(
              norma.id_norma,
              bloque.id_bloque,
              latestId,
              services.dryRun,
            );
          }
        }

        stats.normasProcessed += 1;
        await services.repos.syncState.markNormaSuccess(norma.id_norma, new Date(), services.dryRun);
      } catch (error) {
        stats.normasFailed += 1;
        const message = error instanceof Error ? error.message : String(error);
        await services.repos.syncState.markNormaError(
          norma.id_norma,
          message,
          new Date(),
          services.dryRun,
        );
        services.logger.error(
          {
            err: message,
            id_norma: norma.id_norma,
          },
          "Sync failed for norma",
        );
      }
    }),
  );

  await Promise.all(tasks);

  if (options.failOnErrors && stats.normasFailed > 0) {
    throw new Error(`sync failed for ${stats.normasFailed} norma(s)`);
  }

  services.logger.info({ stats }, "Sync completed");
  return stats;
}

export function registerSyncCommand(
  program: Command,
  getServices: () => Promise<AppServices>,
): void {
  program
    .command("sync")
    .description("Sincroniza indices y bloques de normas ya descubiertas")
    .option("--from <date>", "Fecha inicio (YYYY-MM-DD) sobre fecha_actualizacion")
    .option("--to <date>", "Fecha fin (YYYY-MM-DD) sobre fecha_actualizacion")
    .option("--all", "Procesar todas las normas de Mongo")
    .option("--norma-id <ids...>", "Lista de id_norma a sincronizar")
    .option("--max-normas <number>", "Maximo de normas a procesar", parseOptionalInt)
    .option("--concurrency <number>", "Concurrencia de sync", parseOptionalInt)
    .option("--discover-first", "Ejecuta discover antes de sync")
    .option(
      "--discover-limit <number>",
      "Limite para discover cuando se usa --discover-first (-1 para todo)",
      parseOptionalInt,
    )
    .option(
      "--discover-batch-size <number>",
      "Tamano de pagina para discover interno",
      parseOptionalInt,
    )
    .option("--fail-on-errors", "Devuelve exit code != 0 si falla alguna norma")
    .action(async (cmdOptions: SyncRunOptions) => {
      const services = await getServices();
      await runSync(services, cmdOptions);
    });
}

