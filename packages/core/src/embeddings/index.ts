export interface Embedder {
  embed(text: string): Promise<number[]>;
}

type EmbeddingsProvider = "local" | "openai";
type FallbackProvider = "none" | "openai";

interface EmbeddingsConfig {
  provider: EmbeddingsProvider;
  fallbackProvider: FallbackProvider;
  model: string;
  timeoutMs: number;
  localUrl: string;
  openaiApiKey: string | null;
  openaiBaseUrl: string;
  openaiModel: string;
}

function parseIntegerEnv(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw) {
    return defaultValue;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`ENV ${name} must be an integer. Received: ${raw}`);
  }
  return parsed;
}

function parseEnumEnv<T extends string>(
  name: string,
  allowed: readonly T[],
  defaultValue: T,
): T {
  const raw = process.env[name];
  if (!raw) {
    return defaultValue;
  }

  const normalized = raw.trim().toLowerCase();
  const match = allowed.find((candidate) => candidate === normalized);
  if (!match) {
    throw new Error(`ENV ${name} must be one of: ${allowed.join(", ")}. Received: ${raw}`);
  }
  return match;
}

function parseArrayEmbedding(payload: unknown): number[] {
  if (!Array.isArray(payload)) {
    throw new Error("Embedding payload is not an array");
  }

  if (payload.length === 0) {
    throw new Error("Embedding payload is empty");
  }

  const vector = payload.map((value, index) => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`Embedding value at index ${index} is invalid`);
    }
    return value;
  });

  return vector;
}

function extractEmbeddingFromPayload(payload: unknown): number[] {
  if (payload === null || typeof payload !== "object") {
    throw new Error("Embedding response must be a JSON object");
  }

  const record = payload as Record<string, unknown>;

  if (Array.isArray(record.embedding)) {
    return parseArrayEmbedding(record.embedding);
  }

  if (Array.isArray(record.data) && record.data.length > 0) {
    const first = record.data[0];
    if (first && typeof first === "object" && Array.isArray((first as Record<string, unknown>).embedding)) {
      return parseArrayEmbedding((first as Record<string, unknown>).embedding);
    }
  }

  if (Array.isArray(record.embeddings) && record.embeddings.length > 0) {
    const first = record.embeddings[0];
    if (Array.isArray(first)) {
      return parseArrayEmbedding(first);
    }
  }

  throw new Error("Embedding response does not include an embedding vector");
}

class LocalEmbedder implements Embedder {
  constructor(
    private readonly url: string,
    private readonly model: string,
    private readonly timeoutMs: number,
  ) {}

  private async embedWithBody(payload: Record<string, unknown>): Promise<number[] | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        return null;
      }

      const responsePayload = (await response.json()) as unknown;
      return extractEmbeddingFromPayload(responsePayload);
    } catch (error) {
      // Si falla el parsing o cualquier otro error, devolver null
      // para permitir intentar con otro formato de payload
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  async embed(text: string): Promise<number[]> {
    const openAiShape = await this.embedWithBody({
      model: this.model,
      input: text,
    });
    if (openAiShape) {
      return openAiShape;
    }

    const ollamaShape = await this.embedWithBody({
      model: this.model,
      prompt: text,
    });
    if (ollamaShape) {
      return ollamaShape;
    }

    throw new Error("Local embedder failed for both supported payload shapes");
  }
}

class OpenAIEmbedder implements Embedder {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly model: string,
    private readonly timeoutMs: number,
  ) {}

  async embed(text: string): Promise<number[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl.replace(/\/+$/, "")}/embeddings`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          input: text,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`OpenAI embedder failed (${response.status} ${response.statusText})`);
      }

      const payload = (await response.json()) as unknown;
      return extractEmbeddingFromPayload(payload);
    } finally {
      clearTimeout(timeout);
    }
  }
}

class FallbackEmbedder implements Embedder {
  constructor(
    private readonly primary: Embedder,
    private readonly fallback: Embedder | null,
  ) {}

  async embed(text: string): Promise<number[]> {
    try {
      return await this.primary.embed(text);
    } catch (error) {
      if (!this.fallback) {
        throw error;
      }
      return this.fallback.embed(text);
    }
  }
}

function loadEmbeddingsConfig(): EmbeddingsConfig {
  return {
    provider: parseEnumEnv("EMBEDDINGS_PROVIDER", ["local", "openai"], "local"),
    fallbackProvider: parseEnumEnv("EMBEDDINGS_FALLBACK_PROVIDER", ["none", "openai"], "none"),
    model: process.env.EMBEDDINGS_MODEL ?? "bge-m3",
    timeoutMs: parseIntegerEnv("EMBEDDINGS_TIMEOUT_MS", 10000),
    localUrl: process.env.LOCAL_EMBEDDINGS_URL ?? "http://127.0.0.1:11434/api/embeddings",
    openaiApiKey: process.env.OPENAI_API_KEY ?? null,
    openaiBaseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    openaiModel: process.env.OPENAI_EMBEDDINGS_MODEL ?? "text-embedding-3-large",
  };
}

export function createEmbedderFromEnv(): Embedder {
  const config = loadEmbeddingsConfig();

  const openaiEmbedder =
    config.openaiApiKey && config.openaiApiKey.trim().length > 0
      ? new OpenAIEmbedder(
          config.openaiBaseUrl,
          config.openaiApiKey,
          config.openaiModel,
          config.timeoutMs,
        )
      : null;

  if (config.provider === "openai") {
    if (!openaiEmbedder) {
      throw new Error("OPENAI_API_KEY is required when EMBEDDINGS_PROVIDER=openai");
    }
    return openaiEmbedder;
  }

  const primary = new LocalEmbedder(config.localUrl, config.model, config.timeoutMs);
  const fallback = config.fallbackProvider === "openai" ? openaiEmbedder : null;

  if (config.fallbackProvider === "openai" && !fallback) {
    throw new Error("OPENAI_API_KEY is required when EMBEDDINGS_FALLBACK_PROVIDER=openai");
  }

  return new FallbackEmbedder(primary, fallback);
}
