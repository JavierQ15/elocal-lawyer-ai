export interface AppConfig {
  boeBaseUrl: string;
  boeIndiceTemplate: string;
  boeBloqueTemplate: string;
  mongoUri: string;
  mongoDb: string;
  storageRoot: string;
  requestConcurrency: number;
  httpTimeoutMs: number;
  userAgent: string;
  retryCount: number;
  retryBackoffMs: number;
  storeRawSnapshots: boolean;
  storeXmlInMongo: boolean;
  storePrettyXmlInMongo: boolean;
  chunkSize: number;
  chunkOverlap: number;
  chunkMethod: "recursive" | "simple";
  textExtractor: "fastxml" | "xpath";
  normalizeTerritory: boolean;
}

const DEFAULT_BOE_BASE_URL = "https://www.boe.es/datosabiertos/api/legislacion-consolidada";

function parseIntEnv(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw) {
    return defaultValue;
  }

  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`ENV ${name} must be an integer. Received: ${raw}`);
  }
  return parsed;
}

function parseBoolEnv(name: string, defaultValue = false): boolean {
  const raw = process.env[name];
  if (!raw) {
    return defaultValue;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function parseEnumEnv<T extends string>(
  name: string,
  values: readonly T[],
  defaultValue: T,
): T {
  const raw = process.env[name];
  if (!raw) {
    return defaultValue;
  }

  const normalized = raw.trim().toLowerCase();
  const match = values.find((value) => value === normalized);
  if (!match) {
    throw new Error(`ENV ${name} must be one of: ${values.join(", ")}. Received: ${raw}`);
  }

  return match;
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

export function buildTemplateUrl(template: string, params: Record<string, string>): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key: string) => {
    const value = params[key];
    if (value === undefined) {
      throw new Error(`Template variable {${key}} is missing`);
    }

    // `base` is expected to be a full absolute URL and must not be URL-encoded.
    if (key === "base") {
      return normalizeBaseUrl(value);
    }

    return encodeURIComponent(value);
  });
}

export function loadConfig(): AppConfig {
  const boeBaseUrl = normalizeBaseUrl(process.env.BOE_BASE_URL ?? DEFAULT_BOE_BASE_URL);

  return {
    boeBaseUrl,
    boeIndiceTemplate:
      process.env.BOE_INDICE_TEMPLATE ?? "{base}/id/{id_norma}/texto/indice",
    boeBloqueTemplate:
      process.env.BOE_BLOQUE_TEMPLATE ?? "{base}/id/{id_norma}/texto/bloque/{id_bloque}",
    mongoUri: process.env.MONGO_URI ?? "mongodb://localhost:27017",
    mongoDb: process.env.MONGO_DB ?? "boe_rag",
    storageRoot: process.env.STORAGE_ROOT ?? "./data/boe",
    requestConcurrency: parseIntEnv("REQUEST_CONCURRENCY", 4),
    httpTimeoutMs: parseIntEnv("HTTP_TIMEOUT_MS", 30000),
    userAgent: process.env.USER_AGENT ?? "BOE-RAG-Client/1.0",
    retryCount: parseIntEnv("RETRY_COUNT", 5),
    retryBackoffMs: parseIntEnv("RETRY_BACKOFF_MS", 500),
    storeRawSnapshots: parseBoolEnv("STORE_RAW_SNAPSHOTS", false),
    storeXmlInMongo: parseBoolEnv("STORE_XML_IN_MONGO", false),
    storePrettyXmlInMongo: parseBoolEnv("STORE_PRETTY_XML_IN_MONGO", false),
    chunkSize: parseIntEnv("CHUNK_SIZE", 800),
    chunkOverlap: parseIntEnv("CHUNK_OVERLAP", 120),
    chunkMethod: parseEnumEnv("CHUNK_METHOD", ["recursive", "simple"], "recursive"),
    textExtractor: parseEnumEnv("TEXT_EXTRACTOR", ["fastxml", "xpath"], "fastxml"),
    normalizeTerritory: parseBoolEnv("NORMALIZE_TERRITORY", true),
  };
}
