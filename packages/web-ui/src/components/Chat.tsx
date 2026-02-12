import type { FormEvent, KeyboardEvent } from "react";
import { Citations } from "./Citations";
import type { ChatMessage } from "../types";

interface ChatProps {
  messages: ChatMessage[];
  draft: string;
  loading: boolean;
  errorMessage: string | null;
  onViewUnidad: (idUnidad: string) => void;
  onDraftChange: (next: string) => void;
  onSend: () => void;
}

function bubbleStyles(role: ChatMessage["role"]): string {
  if (role === "user") {
    return "ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-slatebrand-700 px-4 py-3 text-white";
  }
  return "mr-auto max-w-[85%] rounded-2xl rounded-bl-sm border border-slatebrand-100 bg-slatebrand-50 px-4 py-3 text-slatebrand-900";
}

export function Chat({
  messages,
  draft,
  loading,
  errorMessage,
  onViewUnidad,
  onDraftChange,
  onSend,
}: ChatProps) {
  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    onSend();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSend();
    }
  }

  return (
    <section className="flex h-[82vh] flex-col rounded-3xl border border-slatebrand-200 bg-white/95 shadow-panel backdrop-blur">
      <header className="border-b border-slatebrand-100 px-5 py-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slatebrand-700">
          Conversacion
        </h2>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {messages.map((message) => (
          <article key={message.id}>
            <div className={bubbleStyles(message.role)}>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>
            </div>
            {message.role === "assistant" && message.citations && message.citations.length > 0 ? (
              <Citations items={message.citations} onViewUnidad={onViewUnidad} />
            ) : null}
          </article>
        ))}

        {loading ? (
          <div className="mr-auto inline-flex items-center gap-2 rounded-full border border-slatebrand-200 bg-slatebrand-50 px-3 py-2 text-xs font-medium text-slatebrand-700">
            <span className="h-2 w-2 animate-pulse rounded-full bg-slatebrand-600" />
            buscando...
          </div>
        ) : null}
      </div>

      <footer className="border-t border-slatebrand-100 p-4">
        <form className="space-y-2" onSubmit={handleSubmit}>
          <textarea
            rows={3}
            value={draft}
            disabled={loading}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Escribe tu consulta juridica y pulsa Enter..."
            className="w-full resize-none rounded-2xl border border-slatebrand-200 bg-slatebrand-50 px-4 py-3 text-sm text-slatebrand-900 outline-none transition focus:border-slatebrand-400"
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-slatebrand-600">Enter para enviar. Shift+Enter para salto de linea.</p>
            <button
              type="submit"
              disabled={loading}
              className="rounded-xl bg-slatebrand-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slatebrand-600 disabled:cursor-not-allowed disabled:bg-slatebrand-300"
            >
              Enviar
            </button>
          </div>
        </form>
        {errorMessage ? <p className="mt-2 text-xs font-medium text-red-700">{errorMessage}</p> : null}
      </footer>
    </section>
  );
}
