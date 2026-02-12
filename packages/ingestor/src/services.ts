import type { Db } from "mongodb";
import type { Logger } from "pino";
import type { AppConfig } from "@boe/core/config";
import type { BoeClient } from "@boe/core/client/boeClient";
import type { FsStore } from "@boe/core/storage/fsStore";
import type { Repositories } from "@boe/core/db/mongo";

export interface AppServices {
  config: AppConfig;
  logger: Logger;
  db: Db;
  client: BoeClient;
  fsStore: FsStore;
  repos: Repositories;
  dryRun: boolean;
}

