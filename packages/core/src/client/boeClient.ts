import axios, { AxiosError, type AxiosRequestConfig } from "axios";
import type { Logger } from "pino";
import { buildTemplateUrl, type AppConfig } from "../config";
import type { DiscoverFilters, DiscoverResponse } from "../types";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) {
    return false;
  }

  const axiosError = error as AxiosError;
  const status = axiosError.response?.status;
  if (status === undefined) {
    return true;
  }

  if (status === 429) {
    return true;
  }

  return status >= 500;
}

export class BoeClient {
  private readonly http = axios.create();

  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {
    this.http.defaults.timeout = config.httpTimeoutMs;
    this.http.defaults.headers.common["User-Agent"] = config.userAgent;
  }

  private async requestWithRetry<T>(requestConfig: AxiosRequestConfig): Promise<T> {
    let attempt = 0;

    while (true) {
      try {
        const response = await this.http.request<T>(requestConfig);
        return response.data;
      } catch (error) {
        if (!isRetryableError(error) || attempt >= this.config.retryCount) {
          throw error;
        }

        const base = this.config.retryBackoffMs * (2 ** attempt);
        const jitter = Math.floor(Math.random() * this.config.retryBackoffMs);
        const delayMs = base + jitter;

        this.logger.warn(
          {
            err: axios.isAxiosError(error)
              ? {
                  message: error.message,
                  code: error.code,
                  status: error.response?.status,
                  url: requestConfig.url,
                }
              : error,
            attempt,
            delayMs,
          },
          "Retrying BOE request",
        );

        await sleep(delayMs);
        attempt += 1;
      }
    }
  }

  async listNormas(filters: DiscoverFilters): Promise<DiscoverResponse> {
    const params: Record<string, string | number> = {};
    if (filters.from) {
      params.from = filters.from;
    }
    if (filters.to) {
      params.to = filters.to;
    }
    if (typeof filters.offset === "number") {
      params.offset = filters.offset;
    }
    if (typeof filters.limit === "number") {
      params.limit = filters.limit;
    }
    if (filters.query) {
      params.query = filters.query;
    }

    return this.requestWithRetry<DiscoverResponse>({
      method: "GET",
      url: this.config.boeBaseUrl,
      headers: {
        Accept: "application/json",
      },
      params,
    });
  }

  async fetchIndiceXml(idNorma: string): Promise<string> {
    const url = buildTemplateUrl(this.config.boeIndiceTemplate, {
      base: this.config.boeBaseUrl,
      id_norma: idNorma,
    });

    return this.requestWithRetry<string>({
      method: "GET",
      url,
      headers: {
        Accept: "application/xml",
      },
      responseType: "text",
      transformResponse: [(value) => value],
    });
  }

  async fetchBloqueXml(idNorma: string, idBloque: string): Promise<string> {
    const url = buildTemplateUrl(this.config.boeBloqueTemplate, {
      base: this.config.boeBaseUrl,
      id_norma: idNorma,
      id_bloque: idBloque,
    });

    return this.requestWithRetry<string>({
      method: "GET",
      url,
      headers: {
        Accept: "application/xml",
      },
      responseType: "text",
      transformResponse: [(value) => value],
    });
  }
}
