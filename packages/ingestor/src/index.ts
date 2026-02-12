import "dotenv/config";
import { Command } from "commander";
import { loadConfig } from "@boe/core/config";
import { createLogger } from "@boe/core/logger";
import { createMongoContext, type MongoContext } from "@boe/core/db/mongo";
import { BoeClient } from "@boe/core/client/boeClient";
import { FsStore } from "@boe/core/storage/fsStore";
import { registerDiscoverCommand } from "./commands/discover";
import { registerSyncCommand } from "./commands/sync";
import type { AppServices } from "./services";

async function main(): Promise<void> {
  const verbose = process.argv.includes("--verbose") || process.argv.includes("-v");
  const dryRun = process.argv.includes("--dry-run");

  const logger = createLogger(verbose);
  const config = loadConfig();
  let mongo: MongoContext | null = null;
  let services: AppServices | null = null;

  async function getServices(): Promise<AppServices> {
    if (services) {
      return services;
    }

    mongo = await createMongoContext(config, logger);
    services = {
      config,
      logger,
      db: mongo.db,
      client: new BoeClient(config, logger),
      fsStore: new FsStore(config.storageRoot),
      repos: mongo.repos,
      dryRun,
    };

    return services;
  }

  const program = new Command();

  program
    .name("boe-ingestor")
    .description("CLI de ingesta idempotente para discover/sync BOE")
    .option("--dry-run", "Simula la ejecucion sin persistir cambios")
    .option("-v, --verbose", "Activa logs debug");

  registerDiscoverCommand(program, getServices);
  registerSyncCommand(program, getServices);

  try {
    await program.parseAsync(process.argv);
  } finally {
    const mongoContext = mongo as MongoContext | null;
    if (mongoContext !== null) {
      await mongoContext.client.close();
    }
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});

