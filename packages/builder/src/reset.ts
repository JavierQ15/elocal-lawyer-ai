import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { Db } from "mongodb";
import type { Logger } from "pino";

interface ResetOptions {
  dryRun: boolean;
  noConfirm?: boolean;
  dropLegacy?: boolean;
}

const SEMANTIC_COLLECTIONS = ["unidades", "chunks_semanticos", "territorios"];
const LEGACY_COLLECTIONS = ["chunks", "versiones", "bloques", "indices"];

async function askConfirmation(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question(`${question} (yes/no): `);
    return answer.trim().toLowerCase() === "yes";
  } finally {
    rl.close();
  }
}

async function safeDrop(db: Db, name: string, dryRun: boolean): Promise<boolean> {
  const exists = (await db.listCollections({ name }).toArray()).length > 0;
  if (!exists) {
    return false;
  }

  if (!dryRun) {
    await db.collection(name).drop();
  }

  return true;
}

export async function maybeResetCollections(
  db: Db,
  logger: Logger,
  options: ResetOptions,
): Promise<boolean> {
  if (!options.noConfirm) {
    const ok = await askConfirmation(
      options.dropLegacy
        ? "Vas a borrar colecciones semanticas y legacy (chunks/versiones/bloques/indices). Continuar"
        : "Vas a borrar colecciones semanticas (unidades/chunks_semanticos/territorios). Continuar",
    );

    if (!ok) {
      logger.warn("Reset cancelado por el usuario");
      return false;
    }
  }

  const targets = options.dropLegacy
    ? [...SEMANTIC_COLLECTIONS, ...LEGACY_COLLECTIONS]
    : SEMANTIC_COLLECTIONS;

  for (const collection of targets) {
    const dropped = await safeDrop(db, collection, options.dryRun);
    logger.info(
      {
        collection,
        dropped,
        dryRun: options.dryRun,
      },
      "reset collection",
    );
  }

  return true;
}

