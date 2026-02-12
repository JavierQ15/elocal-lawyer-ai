import "dotenv/config";
import { createLogger } from "@boe/core/logger";
import { loadConfig } from "@boe/core/config";
import { createMongoContext } from "@boe/core/db/mongo";
import type { NormaDoc } from "@boe/core/db/repositories";
import { normalizeTerritorioFromRaw } from "@boe/core/utils/territorio";

async function main(): Promise<void> {
  const verbose = process.argv.includes("--verbose") || process.argv.includes("-v");
  const dryRun = process.argv.includes("--dry-run");

  const logger = createLogger(verbose);
  const config = loadConfig();

  if (!config.normalizeTerritory) {
    logger.warn("NORMALIZE_TERRITORY=false. Migration skipped.");
    return;
  }

  const mongo = await createMongoContext(config, logger);

  let processed = 0;
  let updated = 0;
  let skipped = 0;

  try {
    const normasCollection = mongo.db.collection<NormaDoc>("normas");
    const cursor = normasCollection.find({}, { projection: { id_norma: 1, raw_item_json: 1 } });

    for await (const norma of cursor) {
      processed += 1;
      const normalized = normalizeTerritorioFromRaw(norma.raw_item_json ?? {});

      const changed = await mongo.repos.normas.updateTerritorioById(
        norma.id_norma,
        {
          ambito_codigo: normalized.ambito_codigo,
          departamento_codigo: normalized.departamento_codigo,
          territorio: normalized.territorio,
        },
        dryRun,
      );

      if (changed) {
        updated += 1;
      } else {
        skipped += 1;
      }
    }

    logger.info(
      {
        processed,
        updated,
        skipped,
        dryRun,
      },
      "migrate:territorio completed",
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

