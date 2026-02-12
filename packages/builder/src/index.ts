import "dotenv/config";
import { Command } from "commander";
import { loadConfig } from "@boe/core/config";
import { createLogger } from "@boe/core/logger";
import { createMongoContext, type MongoContext } from "@boe/core/db/mongo";
import { BoeClient } from "@boe/core/client/boeClient";
import { FsStore } from "@boe/core/storage/fsStore";
import { registerBuildUnidadesCommand, runBuildUnidades } from "./commands/buildUnidades";
import { registerBuildChunksCommand, runBuildChunks } from "./commands/buildChunks";
import { registerRagCheckCommand } from "./commands/ragCheck";
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
    .name("boe-builder")
    .description("CLI para build-unidades y build-chunks")
    .option("--dry-run", "Simula la ejecucion sin persistir cambios")
    .option("-v, --verbose", "Activa logs debug");

  registerBuildUnidadesCommand(program, getServices);
  registerBuildChunksCommand(program, getServices);
  registerRagCheckCommand(program, getServices);

  program
    .command("build-all")
    .description("Ejecuta build-unidades seguido de build-chunks")
    .option("--all", "Procesa todas las normas")
    .option("--concurrency <number>", "Concurrencia")
    .option("--from <date>", "Fecha inicio (YYYY-MM-DD)")
    .option("--to <date>", "Fecha fin (YYYY-MM-DD)")
    .action(async (options: { all?: boolean; concurrency?: string; from?: string; to?: string }) => {
      const app = await getServices();
      const concurrency = options.concurrency ? Number.parseInt(options.concurrency, 10) : undefined;

      await runBuildUnidades(app, {
        all: options.all,
        concurrency,
        from: options.from,
        to: options.to,
      });

      await runBuildChunks(app, {
        all: options.all,
        concurrency,
        from: options.from,
        to: options.to,
      });
    });

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

