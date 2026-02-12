import "dotenv/config";
import fs from "node:fs";
import { Command } from "commander";
import { createLogger } from "@boe/core/logger";
import { loadConfig } from "@boe/core/config";
import { createMongoContext } from "@boe/core/db/mongo";
import type { ChunkDoc } from "@boe/core/db/repositories";

interface ExportOptions {
  out: string;
  territorio?: string[];
  excludeTerritorio?: string[];
  includeEstatal?: boolean;
}

async function main(): Promise<void> {
  const program = new Command();

  program
    .requiredOption("--out <path>", "NDJSON output path")
    .option("--territorio <codes...>", "Territory codes to include (e.g. CCAA:8070)")
    .option("--exclude-territorio <codes...>", "Territory codes to exclude")
    .option("--include-estatal", "Also include ES:STATE territory");

  program.parse(process.argv);
  const options = program.opts<ExportOptions>();

  const logger = createLogger(process.argv.includes("--verbose") || process.argv.includes("-v"));
  const config = loadConfig();
  const mongo = await createMongoContext(config, logger);

  try {
    const chunksCollection = mongo.db.collection<ChunkDoc>("chunks");

    const includeSet = new Set(options.territorio ?? []);
    if (options.includeEstatal) {
      includeSet.add("ES:STATE");
    }

    const excludeSet = new Set(options.excludeTerritorio ?? []);

    const query: Record<string, unknown> = {};

    if (includeSet.size > 0) {
      query["metadata.territorio.codigo"] = { $in: [...includeSet] };
    }

    if (excludeSet.size > 0) {
      const existingFilter = query["metadata.territorio.codigo"] as Record<string, unknown> | undefined;
      query["metadata.territorio.codigo"] = {
        ...(existingFilter ?? {}),
        $nin: [...excludeSet],
      };
    }

    const stream = fs.createWriteStream(options.out, { encoding: "utf8" });
    let exported = 0;

    const cursor = chunksCollection.find(query).sort({ id_version: 1, chunk_index: 1 });

    for await (const chunk of cursor) {
      const row = {
        id: chunk._id,
        text: chunk.texto,
        metadata: chunk.metadata,
      };
      stream.write(`${JSON.stringify(row)}\n`);
      exported += 1;
    }

    await new Promise<void>((resolve, reject) => {
      stream.on("finish", () => resolve());
      stream.on("error", (error) => reject(error));
      stream.end();
    });

    logger.info(
      {
        out: options.out,
        exported,
        includeTerritorio: [...includeSet],
        excludeTerritorio: [...excludeSet],
      },
      "export:chunks completed",
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

