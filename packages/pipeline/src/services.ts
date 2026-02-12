import { loadConfig, type AppConfig } from "@boe/core/config";
import { createLogger } from "@boe/core/logger";
import { createMongoContext, type MongoContext } from "@boe/core/db/mongo";
import { BoeClient } from "@boe/core/client/boeClient";
type PipelineLogger = ReturnType<typeof createLogger>;

export interface PipelineServices {
  config: AppConfig;
  logger: PipelineLogger;
  mongo: MongoContext;
  boeClient: BoeClient;
}

export async function createPipelineServices(options: { verbose?: boolean } = {}): Promise<PipelineServices> {
  const config = loadConfig();
  const logger = createLogger(options.verbose ?? false);
  const mongo = await createMongoContext(config, logger);

  return {
    config,
    logger,
    mongo,
    boeClient: new BoeClient(config, logger),
  };
}

export async function closePipelineServices(services: PipelineServices): Promise<void> {
  await services.mongo.client.close();
}
