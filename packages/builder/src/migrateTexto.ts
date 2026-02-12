import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { createLogger } from "@boe/core/logger";
import { loadConfig } from "@boe/core/config";
import { createMongoContext } from "@boe/core/db/mongo";
import type {
  BloqueDoc,
  ChunkMetadataDoc,
  NormaDoc,
  VersionDoc,
} from "@boe/core/db/repositories";
import { buildVersionChunks, estimateTokensByChars, extractPlainTextFromXml } from "@boe/core/utils/ragText";
import { sha256 } from "@boe/core/utils/hash";

async function readVersionXml(version: VersionDoc, storageRoot: string): Promise<string | null> {
  if (typeof version.xml_raw === "string" && version.xml_raw.length > 0) {
    return version.xml_raw;
  }

  if (!version.file_path) {
    return null;
  }

  const absolutePath = path.isAbsolute(version.file_path)
    ? version.file_path
    : path.resolve(storageRoot, version.file_path);

  try {
    return await fs.readFile(absolutePath, "utf8");
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const verbose = process.argv.includes("--verbose") || process.argv.includes("-v");
  const dryRun = process.argv.includes("--dry-run");

  const logger = createLogger(verbose);
  const config = loadConfig();
  const mongo = await createMongoContext(config, logger);

  const versionesCollection = mongo.db.collection<VersionDoc>("versiones");
  const normasCollection = mongo.db.collection<NormaDoc>("normas");
  const bloquesCollection = mongo.db.collection<BloqueDoc>("bloques");

  const normaCache = new Map<string, NormaDoc | null>();
  const bloqueCache = new Map<string, BloqueDoc | null>();

  let processed = 0;
  let updatedVersions = 0;
  let unchangedVersions = 0;
  let skippedNoXml = 0;
  let skippedNoNormaOrBloque = 0;
  let chunksCreated = 0;
  let chunksExisting = 0;
  let failures = 0;

  try {
    const cursor = versionesCollection.find({}, { sort: { created_at: 1 } });

    for await (const version of cursor) {
      processed += 1;

      try {
        const xmlRaw = await readVersionXml(version, config.storageRoot);
        if (!xmlRaw) {
          skippedNoXml += 1;
          continue;
        }

        const normaKey = version.id_norma;
        if (!normaCache.has(normaKey)) {
          const norma = await normasCollection.findOne({ id_norma: normaKey });
          normaCache.set(normaKey, norma);
        }

        const bloqueKey = `${version.id_norma}:${version.id_bloque}`;
        if (!bloqueCache.has(bloqueKey)) {
          const bloque = await bloquesCollection.findOne({
            id_norma: version.id_norma,
            id_bloque: version.id_bloque,
          });
          bloqueCache.set(bloqueKey, bloque);
        }

        const norma = normaCache.get(normaKey) ?? null;
        const bloque = bloqueCache.get(bloqueKey) ?? null;

        if (!norma || !bloque) {
          skippedNoNormaOrBloque += 1;
          continue;
        }

        const textoPlano = extractPlainTextFromXml(xmlRaw, config.textExtractor);
        const textoHash = sha256(textoPlano);
        const nChars = textoPlano.length;
        const nTokensEst = estimateTokensByChars(textoPlano);

        const chunking = {
          method: config.chunkMethod,
          chunk_size: config.chunkSize,
          overlap: config.chunkOverlap,
        } as const;

        const now = new Date();

        const changed = await mongo.repos.versiones.upsertRagFields(
          version.id_version,
          {
            xml_raw: config.storeXmlInMongo ? xmlRaw : null,
            xml_pretty: config.storePrettyXmlInMongo ? xmlRaw : null,
            texto_plano: textoPlano,
            texto_hash: textoHash,
            n_chars: nChars,
            n_tokens_est: nTokensEst,
            chunking,
          },
          now,
          dryRun,
        );

        if (changed) {
          updatedVersions += 1;
        } else {
          unchangedVersions += 1;
        }

        const metadata: ChunkMetadataDoc = {
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
        };

        const chunks = buildVersionChunks({
          id_version: version.id_version,
          texto_plano: textoPlano,
          chunking,
        });

        for (const chunk of chunks) {
          const inserted = await mongo.repos.chunks.insertIfMissing(
            {
              _id: chunk.id_chunk,
              id_version: version.id_version,
              id_norma: version.id_norma,
              id_bloque: version.id_bloque,
              chunk_index: chunk.chunk_index,
              texto: chunk.texto,
              texto_hash: chunk.texto_hash,
              metadata,
              created_at: now,
              last_seen_at: now,
            },
            dryRun,
          );

          if (inserted) {
            chunksCreated += 1;
          } else {
            chunksExisting += 1;
          }
        }
      } catch (error) {
        failures += 1;
        logger.error(
          {
            id_version: version.id_version,
            err: error instanceof Error ? error.message : String(error),
          },
          "Failed processing version in migrate:texto",
        );
      }
    }

    logger.info(
      {
        processed,
        updatedVersions,
        unchangedVersions,
        skippedNoXml,
        skippedNoNormaOrBloque,
        chunksCreated,
        chunksExisting,
        failures,
        dryRun,
      },
      "migrate:texto completed",
    );
  } finally {
    await mongo.client.close();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});

