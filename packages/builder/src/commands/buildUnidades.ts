import fs from "node:fs/promises";
import path from "node:path";
import pLimit from "p-limit";
import { Command } from "commander";
import type { Collection } from "mongodb";
import type { AppServices } from "../services";
import { maybeResetCollections } from "../reset";
import type { BloqueIndiceNormalized } from "@boe/core/types";
import { normalizeCliDateToBoe, parseBoeDate } from "@boe/core/parsers/dates";
import { parseIndiceXml } from "@boe/core/parsers/parseIndice";
import { buildIndiceTree, collectSubtreeNodes, type IndiceTreeNode } from "@boe/core/semantic/indexTree";
import type { ChunkSemanticoDoc, TerritorioCatalogDoc, UnidadDoc, UnidadTipo } from "@boe/core/semantic/contracts";
import {
  buildTextoHash,
  buildUnidadId,
  buildUnidadLineageKey,
  composeSemanticUnitText,
  deriveUnidadRef,
  isHeadingOnlyUnidad,
  normalizeSemanticText,
  shouldKeepSemanticUnit,
} from "@boe/core/semantic/unitBuilder";
import type { BloqueDoc, IndiceDoc, NormaDoc, VersionDoc } from "@boe/core/db/repositories";
import { extractPlainTextFromXml } from "@boe/core/utils/ragText";
import { normalizeTerritorioValue } from "@boe/core/utils/territorio";
import { buildVigenciaHastaIntervals } from "@boe/core/utils/vigencia";

export interface BuildUnidadesOptions {
  from?: string;
  to?: string;
  all?: boolean;
  onlyNorma?: string[];
  concurrency?: number;
  reset?: boolean;
  resetNoConfirm?: boolean;
  resetDropLegacy?: boolean;
  failOnErrors?: boolean;
}

interface BuildUnidadesStats {
  normasProcessed: number;
  normasSkippedNoIndice: number;
  normasFailed: number;
  unidadesGenerated: number;
  unidadesInserted: number;
  unidadesUpdated: number;
  unidadesFiltered: number;
  lineageKeysUpdated: number;
  intervalsUpdated: number;
}

interface LoadedVersion {
  id_version: string;
  id_bloque: string;
  fecha_vigencia_desde: Date | null;
  fecha_publicacion_mod: Date | null;
  id_norma_modificadora: string | null;
  texto_plano: string;
  hash_xml: string;
}

interface UnidadVigenciaIntervalDoc {
  _id: string;
  lineage_key: string;
  fecha_vigencia_desde: Date | null;
  fecha_vigencia_hasta?: Date | null;
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

function resolveStorageFilePath(storageRoot: string, relativeOrAbsolute: string): string {
  if (path.isAbsolute(relativeOrAbsolute)) {
    return relativeOrAbsolute;
  }

  return path.resolve(storageRoot, relativeOrAbsolute);
}

function parseTitleMetadata(raw: Record<string, unknown>): string | null {
  const value = raw.url_eli;
  return typeof value === "string" ? value : null;
}

function normalizeRefFallback(idBloque: string): string {
  return idBloque.replace(/_/g, "-").toUpperCase();
}

function compareVersion(a: LoadedVersion, b: LoadedVersion): number {
  const vigA = a.fecha_vigencia_desde?.getTime() ?? -1;
  const vigB = b.fecha_vigencia_desde?.getTime() ?? -1;

  if (vigA !== vigB) {
    return vigA - vigB;
  }

  const pubA = a.fecha_publicacion_mod?.getTime() ?? -1;
  const pubB = b.fecha_publicacion_mod?.getTime() ?? -1;

  if (pubA !== pubB) {
    return pubA - pubB;
  }

  return a.id_version.localeCompare(b.id_version);
}

function pickLatest(versions: LoadedVersion[]): LoadedVersion | null {
  if (versions.length === 0) {
    return null;
  }

  return [...versions].sort(compareVersion).at(-1) ?? null;
}

function isSameDate(a: Date | null, b: Date | null): boolean {
  if (!a && !b) {
    return true;
  }

  if (!a || !b) {
    return false;
  }

  return a.getTime() === b.getTime();
}

async function recomputeVigenciaHastaByLineageKeys(
  unidadesCollection: Collection<UnidadDoc>,
  lineageKeys: string[],
  now: Date,
  dryRun: boolean,
): Promise<{ lineageKeysUpdated: number; intervalsUpdated: number }> {
  if (lineageKeys.length === 0) {
    return {
      lineageKeysUpdated: 0,
      intervalsUpdated: 0,
    };
  }

  const docs = await unidadesCollection
    .find({ lineage_key: { $in: lineageKeys } })
    .project<UnidadVigenciaIntervalDoc>({
      _id: 1,
      lineage_key: 1,
      fecha_vigencia_desde: 1,
      fecha_vigencia_hasta: 1,
    })
    .toArray();

  if (docs.length === 0) {
    return {
      lineageKeysUpdated: 0,
      intervalsUpdated: 0,
    };
  }

  const docsByLineage = new Map<string, UnidadVigenciaIntervalDoc[]>();
  for (const doc of docs) {
    const list = docsByLineage.get(doc.lineage_key) ?? [];
    list.push(doc);
    docsByLineage.set(doc.lineage_key, list);
  }

  const pendingUpdates: Array<{ _id: string; fecha_vigencia_hasta: Date | null }> = [];

  for (const lineageDocs of docsByLineage.values()) {
    const nextIntervals = buildVigenciaHastaIntervals(lineageDocs);
    const nextUntilById = new Map(nextIntervals.map((item) => [item._id, item.fecha_vigencia_hasta]));

    for (const doc of lineageDocs) {
      const nextHasta = nextUntilById.get(doc._id) ?? null;
      if (isSameDate(doc.fecha_vigencia_hasta ?? null, nextHasta)) {
        continue;
      }

      pendingUpdates.push({
        _id: doc._id,
        fecha_vigencia_hasta: nextHasta,
      });
    }
  }

  if (!dryRun && pendingUpdates.length > 0) {
    await unidadesCollection.bulkWrite(
      pendingUpdates.map((item) => ({
        updateOne: {
          filter: { _id: item._id },
          update: {
            $set: {
              fecha_vigencia_hasta: item.fecha_vigencia_hasta,
              last_seen_at: now,
            },
          },
        },
      })),
    );
  }

  return {
    lineageKeysUpdated: docsByLineage.size,
    intervalsUpdated: pendingUpdates.length,
  };
}

function pickVersionForAnchor(
  versions: LoadedVersion[],
  anchor: { fecha_vigencia_desde: Date | null; id_norma_modificadora: string | null },
): LoadedVersion | null {
  if (versions.length === 0) {
    return null;
  }

  const exact = versions.find(
    (version) =>
      isSameDate(version.fecha_vigencia_desde, anchor.fecha_vigencia_desde) &&
      (version.id_norma_modificadora ?? null) === (anchor.id_norma_modificadora ?? null),
  );

  if (exact) {
    return exact;
  }

  if (anchor.fecha_vigencia_desde) {
    const anchorDateMs = anchor.fecha_vigencia_desde.getTime();
    const candidates = versions
      .filter((version) => {
        if (!version.fecha_vigencia_desde) {
          return false;
        }

        return version.fecha_vigencia_desde.getTime() <= anchorDateMs;
      })
      .sort(compareVersion);

    if (candidates.length > 0) {
      return candidates.at(-1) ?? null;
    }
  }

  return pickLatest(versions);
}

function firstNonEmptyLine(text: string): string | null {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return lines[0] ?? null;
}

function looksNoiseNode(node: IndiceTreeNode): boolean {
  if (node.kind === "NOISE") {
    return true;
  }

  return /(nota|advertencia|r[úu]brica)/i.test(node.titulo_bloque ?? "");
}

function isRootCandidate(node: IndiceTreeNode, byId: Map<string, IndiceTreeNode>): boolean {
  if (node.kind === "HEADER") {
    return false;
  }

  let parentId = node.parent_id;
  while (parentId) {
    const parent = byId.get(parentId);
    if (!parent) {
      break;
    }

    if (parent.kind !== "HEADER") {
      return false;
    }

    parentId = parent.parent_id;
  }

  return true;
}

async function loadIndiceXml(indiceDoc: IndiceDoc, storageRoot: string): Promise<string> {
  const absolutePath = resolveStorageFilePath(storageRoot, indiceDoc.file_path);
  return fs.readFile(absolutePath, "utf8");
}

async function loadVersionText(
  version: VersionDoc,
  storageRoot: string,
  extractor: "fastxml" | "xpath",
): Promise<string> {
  if (typeof version.texto_plano === "string" && version.texto_plano.trim().length > 0) {
    return normalizeSemanticText(version.texto_plano);
  }

  if (typeof version.xml_raw === "string" && version.xml_raw.length > 0) {
    return normalizeSemanticText(extractPlainTextFromXml(version.xml_raw, extractor));
  }

  const absolutePath = resolveStorageFilePath(storageRoot, version.file_path);
  const xml = await fs.readFile(absolutePath, "utf8");
  return normalizeSemanticText(extractPlainTextFromXml(xml, extractor));
}

async function ensureTerritorioCatalog(
  territoriosCollection: Collection<TerritorioCatalogDoc>,
  norma: NormaDoc,
  now: Date,
  dryRun: boolean,
): Promise<void> {
  const normalized = normalizeTerritorioValue(norma.territorio);

  const docs: TerritorioCatalogDoc[] = [
    {
      _id: "ES:STATE",
      codigo: "ES:STATE",
      nombre: "España (Estatal)",
      tipo: "ESTATAL",
      departamento_codigo: null,
      created_at: now,
      last_seen_at: now,
    },
  ];

  if (normalized.tipo === "AUTONOMICO") {
    docs.push({
      _id: normalized.codigo,
      codigo: normalized.codigo,
      nombre: normalized.nombre,
      tipo: "AUTONOMICO",
      departamento_codigo: norma.departamento_codigo,
      created_at: now,
      last_seen_at: now,
    });
  }

  for (const doc of docs) {
    if (dryRun) {
      continue;
    }

    await territoriosCollection.updateOne(
      { codigo: doc.codigo },
      {
        $set: {
          nombre: doc.nombre,
          tipo: doc.tipo,
          departamento_codigo: doc.departamento_codigo,
          last_seen_at: now,
        },
        $setOnInsert: {
          _id: doc._id,
          created_at: now,
        },
      },
      { upsert: true },
    );
  }
}

async function processNorma(
  services: AppServices,
  norma: NormaDoc,
  stats: BuildUnidadesStats,
): Promise<void> {
  const indicesCollection = services.db.collection<IndiceDoc>("indices");
  const bloquesCollection = services.db.collection<BloqueDoc>("bloques");
  const versionesCollection = services.db.collection<VersionDoc>("versiones");
  const unidadesCollection = services.db.collection<UnidadDoc>("unidades");
  const territoriosCollection = services.db.collection<TerritorioCatalogDoc>("territorios");

  const indiceDoc = await indicesCollection.findOne(
    { id_norma: norma.id_norma, is_latest: true },
    { sort: { created_at: -1 } },
  );

  if (!indiceDoc) {
    stats.normasSkippedNoIndice += 1;
    return;
  }

  const indiceXml = await loadIndiceXml(indiceDoc, services.config.storageRoot);
  const parsedIndice = parseIndiceXml(indiceXml);

  const bloquesDocs = await bloquesCollection
    .find({ id_norma: norma.id_norma })
    .project({
      id_bloque: 1,
      tipo: 1,
      titulo_bloque: 1,
      url_bloque: 1,
    })
    .toArray();

  const bloqueMap = new Map(bloquesDocs.map((bloque) => [bloque.id_bloque, bloque]));

  const bloquesMerged: BloqueIndiceNormalized[] = parsedIndice.bloques.map((bloque) => {
    const existing = bloqueMap.get(bloque.id_bloque);
    return {
      ...bloque,
      tipo: existing?.tipo ?? bloque.tipo,
      titulo_bloque: existing?.titulo_bloque ?? bloque.titulo_bloque,
      url_bloque: existing?.url_bloque ?? bloque.url_bloque,
    };
  });

  const tree = buildIndiceTree(bloquesMerged);

  const versionesDocs = await versionesCollection
    .find({
      id_norma: norma.id_norma,
      id_bloque: { $in: bloquesMerged.map((bloque) => bloque.id_bloque) },
    })
    .toArray();

  const loadedVersionsByBlock = new Map<string, LoadedVersion[]>();

  for (const version of versionesDocs) {
    const text = await loadVersionText(version, services.config.storageRoot, services.config.textExtractor);
    if (text.length === 0) {
      continue;
    }

    const list = loadedVersionsByBlock.get(version.id_bloque) ?? [];
    list.push({
      id_version: version.id_version,
      id_bloque: version.id_bloque,
      fecha_vigencia_desde: version.fecha_vigencia_desde,
      fecha_publicacion_mod: version.fecha_publicacion_mod,
      id_norma_modificadora: version.id_norma_modificadora,
      texto_plano: text,
      hash_xml: version.hash_xml,
    });
    loadedVersionsByBlock.set(version.id_bloque, list);
  }

  for (const versions of loadedVersionsByBlock.values()) {
    versions.sort(compareVersion);
  }

  const rootCandidates = tree.ordered.filter((node) => isRootCandidate(node, tree.byId));

  const now = new Date();
  const territorio = normalizeTerritorioValue(norma.territorio);
  await ensureTerritorioCatalog(territoriosCollection, norma, now, services.dryRun);

  const generatedDocs: UnidadDoc[] = [];

  for (const root of rootCandidates) {
    const subtree = collectSubtreeNodes(tree, root.id_bloque);

    const rootVersions = loadedVersionsByBlock.get(root.id_bloque) ?? [];
    const fallbackVersions = subtree
      .flatMap((node) => loadedVersionsByBlock.get(node.id_bloque) ?? [])
      .sort(compareVersion);

    const anchorVersions = (rootVersions.length > 0 ? rootVersions : fallbackVersions)
      .map((version) => ({
        fecha_vigencia_desde: version.fecha_vigencia_desde,
        id_norma_modificadora: version.id_norma_modificadora,
      }))
      .filter((anchor, index, self) => {
        return (
          self.findIndex(
            (item) =>
              isSameDate(item.fecha_vigencia_desde, anchor.fecha_vigencia_desde) &&
              (item.id_norma_modificadora ?? null) === (anchor.id_norma_modificadora ?? null),
          ) === index
        );
      });

    if (anchorVersions.length === 0) {
      continue;
    }

    anchorVersions.sort((a, b) => {
      const ta = a.fecha_vigencia_desde?.getTime() ?? -1;
      const tb = b.fecha_vigencia_desde?.getTime() ?? -1;
      return ta - tb;
    });

    for (const anchor of anchorVersions) {
      const selectedBlocks = subtree
        .map((node) => {
          const versions = loadedVersionsByBlock.get(node.id_bloque) ?? [];
          const selected = pickVersionForAnchor(versions, anchor);
          if (!selected) {
            return null;
          }

          return {
            node,
            version: selected,
          };
        })
        .filter((item): item is { node: IndiceTreeNode; version: LoadedVersion } => Boolean(item));

      if (selectedBlocks.length === 0) {
        continue;
      }

      const header = root.titulo_bloque;

      const text = composeSemanticUnitText({
        header,
        blocks: selectedBlocks.map((item) => ({
          id_bloque: item.node.id_bloque,
          titulo_bloque: item.node.titulo_bloque,
          texto_plano: item.version.texto_plano,
          order: item.node.order,
        })),
      });

      const hasChildrenWithContent = selectedBlocks.some(
        (item) => item.node.id_bloque !== root.id_bloque && item.version.texto_plano.length > 0,
      );

      const filter = shouldKeepSemanticUnit({
        unidad_tipo: root.unidad_tipo,
        texto_plano: text,
        hasChildrenWithContent,
        looksNoise: looksNoiseNode(root),
      });

      if (!filter.keep) {
        stats.unidadesFiltered += 1;
        continue;
      }

      const title = firstNonEmptyLine(text) ?? root.titulo_bloque ?? null;
      const unidadRef = deriveUnidadRef(
        filter.unidad_tipo,
        title ?? root.titulo_bloque ?? text,
        normalizeRefFallback(root.id_bloque),
      );

      const textoHash = buildTextoHash(text);
      const idUnidad = buildUnidadId({
        id_norma: norma.id_norma,
        unidad_tipo: filter.unidad_tipo,
        unidad_ref: unidadRef,
        fecha_vigencia_desde: anchor.fecha_vigencia_desde,
        id_norma_modificadora: anchor.id_norma_modificadora,
        texto_hash: textoHash,
      });

      const lineageKey = buildUnidadLineageKey({
        id_norma: norma.id_norma,
        unidad_tipo: filter.unidad_tipo,
        unidad_ref: unidadRef,
      });
      const isHeadingOnly = isHeadingOnlyUnidad(filter.unidad_tipo, text);

      const sourceBloques = selectedBlocks.map((item) => ({
        id_bloque: item.node.id_bloque,
        tipo: item.node.tipo,
        titulo_bloque: item.node.titulo_bloque,
        n_chars: item.version.texto_plano.length,
      }));

      const versionHashes = [...new Set(selectedBlocks.map((item) => item.version.hash_xml))];
      const firstSelectedVersion = selectedBlocks[0]?.version ?? null;

      generatedDocs.push({
        _id: idUnidad,
        id_unidad: idUnidad,
        id_norma: norma.id_norma,
        unidad_tipo: filter.unidad_tipo,
        unidad_ref: unidadRef,
        titulo: title,
        orden: root.order,
        fecha_vigencia_desde: anchor.fecha_vigencia_desde,
        fecha_vigencia_hasta: null,
        fecha_publicacion_mod: firstSelectedVersion?.fecha_publicacion_mod ?? null,
        id_norma_modificadora: anchor.id_norma_modificadora,
        texto_plano: text,
        texto_hash: textoHash,
        n_chars: text.length,
        source: {
          metodo: "merge_bloques",
          bloques_origen: sourceBloques,
          indice_hash: indiceDoc.hash_xml,
          version_hashes: versionHashes,
        },
        metadata: {
          rango_texto: norma.rango_texto,
          ambito_texto: norma.ambito_texto,
          ambito_codigo: norma.ambito_codigo,
          departamento_codigo: norma.departamento_codigo,
          departamento_texto: norma.departamento_texto,
          territorio,
          url_html_consolidada: norma.url_html_consolidada,
          url_eli: parseTitleMetadata(norma.raw_item_json ?? {}),
          tags: [],
        },
        quality: {
          is_heading_only: isHeadingOnly,
          skip_retrieval: isHeadingOnly,
          reason: isHeadingOnly ? "heading_only" : null,
        },
        lineage_key: lineageKey,
        created_at: now,
        last_seen_at: now,
        is_latest: false,
      });
    }
  }

  const deduped = new Map<string, UnidadDoc>();
  for (const doc of generatedDocs) {
    deduped.set(doc._id, doc);
  }

  const docs = [...deduped.values()];
  stats.unidadesGenerated += docs.length;

  const latestByLineage = new Map<string, UnidadDoc>();
  for (const doc of docs) {
    const current = latestByLineage.get(doc.lineage_key);
    if (!current) {
      latestByLineage.set(doc.lineage_key, doc);
      continue;
    }

    const currentDate = current.fecha_vigencia_desde?.getTime() ?? -1;
    const nextDate = doc.fecha_vigencia_desde?.getTime() ?? -1;

    if (nextDate > currentDate) {
      latestByLineage.set(doc.lineage_key, doc);
      continue;
    }

    if (nextDate === currentDate) {
      const currentPub = current.fecha_publicacion_mod?.getTime() ?? -1;
      const nextPub = doc.fecha_publicacion_mod?.getTime() ?? -1;
      if (nextPub > currentPub) {
        latestByLineage.set(doc.lineage_key, doc);
      }
    }
  }

  const latestIds = new Set([...latestByLineage.values()].map((doc) => doc._id));

  for (const doc of docs) {
    const isLatest = latestIds.has(doc._id);

    if (services.dryRun) {
      const exists = await unidadesCollection.countDocuments({ _id: doc._id }, { limit: 1 });
      if (exists > 0) {
        stats.unidadesUpdated += 1;
      } else {
        stats.unidadesInserted += 1;
      }
      continue;
    }

    const result = await unidadesCollection.updateOne(
      { _id: doc._id },
      {
        $set: {
          id_unidad: doc.id_unidad,
          id_norma: doc.id_norma,
          unidad_tipo: doc.unidad_tipo,
          unidad_ref: doc.unidad_ref,
          titulo: doc.titulo,
          orden: doc.orden,
          fecha_vigencia_desde: doc.fecha_vigencia_desde,
          fecha_publicacion_mod: doc.fecha_publicacion_mod,
          id_norma_modificadora: doc.id_norma_modificadora,
          texto_plano: doc.texto_plano,
          texto_hash: doc.texto_hash,
          n_chars: doc.n_chars,
          source: doc.source,
          metadata: doc.metadata,
          quality: doc.quality,
          lineage_key: doc.lineage_key,
          is_latest: isLatest,
          last_seen_at: now,
        },
        $setOnInsert: {
          created_at: now,
          fecha_vigencia_hasta: null,
        },
      },
      { upsert: true },
    );

    if (result.upsertedCount > 0) {
      stats.unidadesInserted += 1;
    } else {
      stats.unidadesUpdated += 1;
    }
  }

  if (!services.dryRun) {
    await unidadesCollection.updateMany(
      { id_norma: norma.id_norma },
      { $set: { is_latest: false } },
    );

    if (latestIds.size > 0) {
      await unidadesCollection.updateMany(
        {
          id_norma: norma.id_norma,
          _id: { $in: [...latestIds] },
        },
        {
          $set: {
            is_latest: true,
            last_seen_at: now,
          },
        },
      );
    }

    const chunksSemanticosCollection = services.db.collection<ChunkSemanticoDoc>("chunks_semanticos");
    await chunksSemanticosCollection.updateMany(
      {
        id_norma: norma.id_norma,
        id_unidad: { $nin: [...latestIds] },
      },
      {
        $set: {
          last_seen_at: now,
        },
      },
    );
  }

  const lineageKeys = (
    await unidadesCollection.distinct("lineage_key", { id_norma: norma.id_norma })
  ).filter((key): key is string => typeof key === "string" && key.length > 0);

  const intervalStats = await recomputeVigenciaHastaByLineageKeys(
    unidadesCollection,
    lineageKeys,
    now,
    services.dryRun,
  );
  stats.lineageKeysUpdated += intervalStats.lineageKeysUpdated;
  stats.intervalsUpdated += intervalStats.intervalsUpdated;

  stats.normasProcessed += 1;
}

export async function runBuildUnidades(
  services: AppServices,
  options: BuildUnidadesOptions,
): Promise<BuildUnidadesStats> {
  const stats: BuildUnidadesStats = {
    normasProcessed: 0,
    normasSkippedNoIndice: 0,
    normasFailed: 0,
    unidadesGenerated: 0,
    unidadesInserted: 0,
    unidadesUpdated: 0,
    unidadesFiltered: 0,
    lineageKeysUpdated: 0,
    intervalsUpdated: 0,
  };

  if (options.reset) {
    const resetOk = await maybeResetCollections(services.db, services.logger, {
      dryRun: services.dryRun,
      noConfirm: options.resetNoConfirm,
      dropLegacy: options.resetDropLegacy,
    });

    if (!resetOk) {
      return stats;
    }
  }

  const fromBoe = normalizeCliDateToBoe(options.from);
  const toBoe = normalizeCliDateToBoe(options.to);

  const fromDate = fromBoe ? toDayStart(parseBoeDate(fromBoe) as Date) : undefined;
  const toDate = toBoe ? toDayEnd(parseBoeDate(toBoe) as Date) : undefined;

  const onlyNorma = options.onlyNorma ?? [];

  const shouldUseAll = options.all || (!fromDate && !toDate && onlyNorma.length === 0);

  const normas = await services.repos.normas.listForSync({
    from: shouldUseAll ? undefined : fromDate,
    to: shouldUseAll ? undefined : toDate,
    ids: onlyNorma.length > 0 ? onlyNorma : undefined,
  });

  const limiter = pLimit(options.concurrency ?? services.config.requestConcurrency);

  await Promise.all(
    normas.map((norma) =>
      limiter(async () => {
        try {
          await processNorma(services, norma, stats);
        } catch (error) {
          stats.normasFailed += 1;
          services.logger.error(
            {
              id_norma: norma.id_norma,
              err: error instanceof Error ? error.message : String(error),
            },
            "build-unidades failed for norma",
          );
        }
      }),
    ),
  );

  if (options.failOnErrors && stats.normasFailed > 0) {
    throw new Error(`build-unidades failed for ${stats.normasFailed} norma(s)`);
  }

  services.logger.info({ stats }, "build-unidades completed");
  return stats;
}

export function registerBuildUnidadesCommand(
  program: Command,
  getServices: () => Promise<AppServices>,
): void {
  program
    .command("build-unidades")
    .description("Construye unidades semanticas (articulos/disposiciones/anexos) a partir de indices y versiones")
    .option("--from <date>", "Fecha inicio (YYYY-MM-DD) sobre fecha_actualizacion de norma")
    .option("--to <date>", "Fecha fin (YYYY-MM-DD) sobre fecha_actualizacion de norma")
    .option("--all", "Procesa todas las normas")
    .option("--only-norma <ids...>", "Lista de id_norma a procesar")
    .option("--concurrency <number>", "Concurrencia", parseOptionalInt)
    .option("--reset", "Resetea colecciones nuevas antes de construir")
    .option("--reset-no-confirm", "Resetea sin confirmacion (CI)")
    .option("--reset-drop-legacy", "En reset, tambien borra chunks/versiones/bloques/indices")
    .option("--fail-on-errors", "Devuelve exit code != 0 si falla alguna norma")
    .action(async (cmdOptions: BuildUnidadesOptions) => {
      const services = await getServices();
      await runBuildUnidades(services, cmdOptions);
    });
}


