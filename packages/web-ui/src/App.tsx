import { useEffect, useMemo, useState } from "react";
import { answerRag, fetchCcaaOptions, fetchUnidadById } from "./api/rag";
import { Chat } from "./components/Chat";
import { Filters } from "./components/Filters";
import type { CcaaOption, ChatMessage, RagUnidadResponse, SearchFiltersState } from "./types";

function createMessageId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function getLocalDateInputValue(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const INITIAL_ASSISTANT_MESSAGE: ChatMessage = {
  id: "assistant-intro",
  role: "assistant",
  content:
    "Consulta normativa por texto libre. Esta vista genera una respuesta redactada con modelo y muestra evidencia citada.",
};

export default function App() {
  const [filters, setFilters] = useState<SearchFiltersState>({
    asOf: getLocalDateInputValue(new Date()),
    mode: "NORMATIVO",
    scope: "ESTATAL",
    ccaaCodigo: "",
    topK: 8,
    minScore: 0.15,
    includePreambulo: false,
  });
  const [messages, setMessages] = useState<ChatMessage[]>([INITIAL_ASSISTANT_MESSAGE]);
  const [draft, setDraft] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedUnidad, setSelectedUnidad] = useState<RagUnidadResponse | null>(null);
  const [selectedUnidadLoading, setSelectedUnidadLoading] = useState<boolean>(false);
  const [selectedUnidadError, setSelectedUnidadError] = useState<string | null>(null);
  const [ccaaOptions, setCcaaOptions] = useState<CcaaOption[]>([]);
  const [ccaaLoading, setCcaaLoading] = useState<boolean>(false);
  const [ccaaError, setCcaaError] = useState<string | null>(null);

  const endpointLabel = useMemo(() => {
    const configured = import.meta.env.VITE_RAG_API_URL?.trim();
    return configured && configured.length > 0 ? configured : "http://localhost:3000";
  }, []);

  useEffect(() => {
    let isMounted = true;
    setCcaaLoading(true);
    setCcaaError(null);

    void fetchCcaaOptions()
      .then((options) => {
        if (!isMounted) {
          return;
        }

        setCcaaOptions(options);
      })
      .catch((error) => {
        if (!isMounted) {
          return;
        }

        const message = error instanceof Error ? error.message : "Error desconocido";
        setCcaaOptions([]);
        setCcaaError(message);
      })
      .finally(() => {
        if (!isMounted) {
          return;
        }

        setCcaaLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  async function handleSend(): Promise<void> {
    const query = draft.trim();
    if (query.length < 3 || isLoading) {
      return;
    }

    if (filters.scope === "AUTONOMICO_MAS_ESTATAL" && filters.ccaaCodigo.trim().length === 0) {
      setErrorMessage("Selecciona una CCAA o escribe un codigo (ej. CCAA:8140).");
      return;
    }

    setErrorMessage(null);
    setDraft("");

    const userMessage: ChatMessage = {
      id: createMessageId("user"),
      role: "user",
      content: query,
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);

    try {
      const response = await answerRag({
        query,
        asOf: filters.asOf,
        scope: filters.scope,
        ccaaCodigo: filters.scope === "AUTONOMICO_MAS_ESTATAL" ? filters.ccaaCodigo.trim() : undefined,
        mode: filters.mode,
        topK: filters.topK,
        minScore: filters.minScore,
        includePreambulo: filters.includePreambulo,
      });

      const assistantMessage: ChatMessage = {
        id: createMessageId("assistant"),
        role: "assistant",
        content: response.answer,
        citations: response.usedCitations,
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error desconocido";
      setMessages((prev) => [
        ...prev,
        {
          id: createMessageId("assistant-error"),
          role: "assistant",
          content: `No pude completar la busqueda: ${message}`,
        },
      ]);
      setErrorMessage(message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleViewUnidad(idUnidad: string): Promise<void> {
    setSelectedUnidadLoading(true);
    setSelectedUnidadError(null);
    setSelectedUnidad(null);

    try {
      const unidad = await fetchUnidadById(idUnidad);
      setSelectedUnidad(unidad);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error al cargar la unidad";
      setSelectedUnidadError(message);
    } finally {
      setSelectedUnidadLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-page px-4 py-4 md:px-8 md:py-6">
      <div className="mx-auto max-w-7xl">
        <header className="mb-4 rounded-3xl border border-slatebrand-200 bg-white/90 p-4 shadow-panel backdrop-blur">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slatebrand-600">BOE RAG</p>
          <h1 className="mt-1 text-2xl font-semibold text-slatebrand-900">Mini ChatGPT Normativo</h1>
          <p className="mt-1 text-sm text-slatebrand-700">API objetivo: {endpointLabel}</p>
        </header>

        <div className="grid gap-4 md:grid-cols-[320px_1fr]">
          <Filters
            value={filters}
            disabled={isLoading}
            ccaaOptions={ccaaOptions}
            ccaaLoading={ccaaLoading}
            ccaaError={ccaaError}
            onChange={setFilters}
          />
          <Chat
            messages={messages}
            draft={draft}
            loading={isLoading}
            errorMessage={errorMessage}
            onViewUnidad={(idUnidad) => void handleViewUnidad(idUnidad)}
            onDraftChange={setDraft}
            onSend={() => void handleSend()}
          />
        </div>
      </div>

      {(selectedUnidadLoading || selectedUnidad || selectedUnidadError) ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slatebrand-900/35 p-4">
          <div className="max-h-[85vh] w-full max-w-4xl overflow-hidden rounded-2xl border border-slatebrand-200 bg-white shadow-panel">
            <header className="flex items-center justify-between border-b border-slatebrand-100 px-4 py-3">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slatebrand-700">
                Unidad completa
              </h3>
              <button
                type="button"
                className="rounded-lg border border-slatebrand-200 px-3 py-1 text-xs font-semibold text-slatebrand-800 hover:bg-slatebrand-100"
                onClick={() => {
                  setSelectedUnidad(null);
                  setSelectedUnidadLoading(false);
                  setSelectedUnidadError(null);
                }}
              >
                Cerrar
              </button>
            </header>

            <div className="max-h-[75vh] overflow-y-auto px-4 py-3">
              {selectedUnidadLoading ? (
                <p className="text-sm text-slatebrand-700">Cargando unidad...</p>
              ) : null}

              {selectedUnidadError ? (
                <p className="text-sm font-medium text-red-700">{selectedUnidadError}</p>
              ) : null}

              {selectedUnidad ? (
                <div className="space-y-3">
                  <p className="text-sm font-semibold text-slatebrand-900">
                    {selectedUnidad.id_norma} - {selectedUnidad.unidad_ref}
                  </p>
                  <div className="flex flex-wrap gap-2 text-xs text-slatebrand-700">
                    <span className="rounded-full bg-slatebrand-100 px-2 py-1">
                      {selectedUnidad.territorio.nombre} ({selectedUnidad.territorio.codigo})
                    </span>
                    <span className="rounded-full bg-slatebrand-100 px-2 py-1">
                      Vigencia: {selectedUnidad.fecha_vigencia_desde?.slice(0, 10) ?? "N/D"} →{" "}
                      {selectedUnidad.fecha_vigencia_hasta?.slice(0, 10) ?? "vigente"}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-slatebrand-900">
                    {selectedUnidad.texto_plano}
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
