import type {
  CcaaCatalogResponse,
  CcaaOption,
  RagAnswerResponse,
  RagSearchRequest,
  RagSearchResponse,
  RagUnidadResponse,
} from "../types";

const DEFAULT_RAG_API_URL = "http://localhost:3000";

function normalizeBaseUrl(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function resolveApiUrl(): string {
  const configured = import.meta.env.VITE_RAG_API_URL?.trim();
  if (configured && configured.length > 0) {
    return normalizeBaseUrl(configured);
  }
  return DEFAULT_RAG_API_URL;
}

const API_BASE_URL = resolveApiUrl();
const RAG_SEARCH_ENDPOINT = `${API_BASE_URL}/rag/search`;
const RAG_ANSWER_ENDPOINT = `${API_BASE_URL}/rag/answer`;
const RAG_CCAA_CATALOG_ENDPOINT = `${API_BASE_URL}/rag/catalog/ccaa`;

async function parseApiResponseOrThrow<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    try {
      const payload = (await response.json()) as { message?: string };
      if (payload.message) {
        message = payload.message;
      }
    } catch {
      // no-op: keep fallback message
    }
    throw new Error(message);
  }

  return (await response.json()) as T;
}

export async function searchRag(body: RagSearchRequest): Promise<RagSearchResponse> {
  const response = await fetch(RAG_SEARCH_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  return parseApiResponseOrThrow<RagSearchResponse>(response);
}

export async function answerRag(body: RagSearchRequest): Promise<RagAnswerResponse> {
  const response = await fetch(RAG_ANSWER_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  return parseApiResponseOrThrow<RagAnswerResponse>(response);
}

export async function fetchUnidadById(idUnidad: string): Promise<RagUnidadResponse> {
  const encoded = encodeURIComponent(idUnidad);
  const response = await fetch(`${API_BASE_URL}/rag/unidad/${encoded}`, {
    method: "GET",
  });

  return parseApiResponseOrThrow<RagUnidadResponse>(response);
}

export async function fetchCcaaOptions(): Promise<CcaaOption[]> {
  const response = await fetch(RAG_CCAA_CATALOG_ENDPOINT, {
    method: "GET",
  });
  const payload = await parseApiResponseOrThrow<CcaaCatalogResponse>(response);

  return payload.items;
}
