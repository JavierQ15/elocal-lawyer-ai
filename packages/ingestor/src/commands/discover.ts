import { Command } from "commander";
import type { AppServices } from "../services";
import { normalizeCliDateToBoe } from "@boe/core/parsers/dates";
import { parseNormasResponse } from "@boe/core/parsers/parseNormas";
import type { NormaNormalized } from "@boe/core/types";

export interface DiscoverRunOptions {
  from?: string;
  to?: string;
  limit?: number;
  batchSize?: number;
  query?: string;
}

export interface DiscoverRunResult {
  totalFetched: number;
  normaIds: string[];
}

function parseOptionalInt(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid integer value: ${value}`);
  }
  return parsed;
}

function maybeDisableTerritory(
  norma: NormaNormalized,
  normalizeTerritory: boolean,
): NormaNormalized {
  if (normalizeTerritory) {
    return norma;
  }

  return {
    ...norma,
    ambito_codigo: null,
    departamento_codigo: null,
    territorio: {
      tipo: "ESTATAL",
      codigo: "ES:STATE",
      nombre: "España (Estatal)",
    },
  };
}

export async function runDiscover(
  services: AppServices,
  options: DiscoverRunOptions,
): Promise<DiscoverRunResult> {
  const from = normalizeCliDateToBoe(options.from);
  const to = normalizeCliDateToBoe(options.to);

  const requestedLimit = options.limit ?? 50;
  const batchSize = options.batchSize ?? 200;

  let offset = 0;
  let remaining = requestedLimit;
  let totalFetched = 0;
  const normaIds: string[] = [];

  services.logger.info(
    {
      from,
      to,
      requestedLimit,
      batchSize,
      dryRun: services.dryRun,
    },
    "Starting discover",
  );

  while (true) {
    const effectiveLimit = requestedLimit === -1 ? batchSize : Math.min(batchSize, remaining);

    if (effectiveLimit <= 0) {
      break;
    }

    const payload = await services.client.listNormas({
      from,
      to,
      offset,
      limit: effectiveLimit,
      query: options.query,
    });

    const parsed = parseNormasResponse(payload);
    if (parsed.length === 0) {
      break;
    }

    const now = new Date();
    for (const norma of parsed) {
      const normaForUpsert = maybeDisableTerritory(norma, services.config.normalizeTerritory);

      await services.repos.normas.upsertFromDiscover(normaForUpsert, now, services.dryRun);
      totalFetched += 1;
      normaIds.push(norma.id_norma);

      if (requestedLimit !== -1) {
        remaining -= 1;
        if (remaining <= 0) {
          break;
        }
      }
    }

    offset += parsed.length;

    if (parsed.length < effectiveLimit) {
      break;
    }

    if (requestedLimit !== -1 && remaining <= 0) {
      break;
    }
  }

  services.logger.info(
    {
      totalFetched,
    },
    "Discover completed",
  );

  return {
    totalFetched,
    normaIds,
  };
}

export function registerDiscoverCommand(
  program: Command,
  getServices: () => Promise<AppServices>,
): void {
  program
    .command("discover")
    .description("Descubre normas desde la API BOE y upserta metadatos en Mongo")
    .option("--from <date>", "Fecha inicio (YYYY-MM-DD) filtrando por fecha_actualizacion")
    .option("--to <date>", "Fecha fin (YYYY-MM-DD) filtrando por fecha_actualizacion")
    .option("--limit <number>", "Numero maximo de resultados. -1 para todos", parseOptionalInt)
    .option("--batch-size <number>", "Tamano de pagina para paginacion", parseOptionalInt)
    .option("--query <json>", "Cadena JSON del parametro query del BOE")
    .action(async (cmdOptions: DiscoverRunOptions) => {
      const services = await getServices();
      await runDiscover(services, cmdOptions);
    });
}

