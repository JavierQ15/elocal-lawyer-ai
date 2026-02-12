import { useMemo, useState } from "react";
import type { RagUsedCitation } from "../types";

interface CitationsProps {
  items: RagUsedCitation[];
  onViewUnidad?: (idUnidad: string) => void;
}

function formatDate(value: string | null): string {
  if (!value) {
    return "vigente";
  }
  return value.slice(0, 10);
}

function formatTerritorio(item: RagUsedCitation): string {
  if (item.territorio.nombre && item.territorio.codigo) {
    return `${item.territorio.nombre} (${item.territorio.codigo})`;
  }
  if (item.territorio.nombre) {
    return item.territorio.nombre;
  }
  if (item.territorio.codigo) {
    return item.territorio.codigo;
  }
  return "Sin territorio";
}

function buildCopyText(item: RagUsedCitation): string {
  const vigenciaHasta = item.vigencia.hasta ? formatDate(item.vigencia.hasta) : "vigente";
  return [
    `[${item.label}]`,
    `Territorio: ${formatTerritorio(item)}`,
    `Vigencia: desde ${formatDate(item.vigencia.desde)} hasta ${vigenciaHasta}`,
    `BOE: ${item.url_html_consolidada ?? "-"}`,
    `ELI: ${item.url_eli ?? "-"}`,
    `Extracto: "${item.excerpt}"`,
  ].join("\n");
}

export function Citations({ items, onViewUnidad }: CitationsProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const sortedItems = useMemo(
    () => [...items].sort((a, b) => b.score - a.score),
    [items],
  );

  async function handleCopy(item: RagUsedCitation): Promise<void> {
    try {
      await navigator.clipboard.writeText(buildCopyText(item));
      setCopiedId(item.id_chunk);
      window.setTimeout(() => setCopiedId(null), 1500);
    } catch {
      setCopiedId(null);
    }
  }

  return (
    <section className="mt-4 space-y-3">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-slatebrand-600">Citas</h4>
      {sortedItems.map((item) => {
        const isExpanded = expanded[item.id_chunk] ?? false;
        const excerpt = isExpanded ? item.excerpt : item.excerpt.slice(0, 500);
        const hasMore = item.excerpt.length > 500;
        const vigenciaHasta = item.vigencia.hasta ? formatDate(item.vigencia.hasta) : "vigente";

        return (
          <article
            key={item.id_chunk}
            className="rounded-2xl border border-slatebrand-100 bg-white p-4 text-sm shadow-sm"
          >
            <h5 className="text-sm font-semibold text-slatebrand-900">{item.label}</h5>

            <div className="mt-2 flex flex-wrap gap-2 text-xs text-slatebrand-700">
              <span className="rounded-full bg-slatebrand-100 px-2 py-1">{formatTerritorio(item)}</span>
              <span className="rounded-full bg-slatebrand-100 px-2 py-1">score {item.score.toFixed(3)}</span>
              {item.id_unidad ? (
                <span className="rounded-full bg-slatebrand-100 px-2 py-1">{item.id_unidad}</span>
              ) : null}
            </div>

            <p className="mt-3 text-xs text-slatebrand-700">
              Vigencia: {formatDate(item.vigencia.desde)} → {vigenciaHasta}
            </p>

            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              {item.url_html_consolidada ? (
                <a
                  className="rounded-lg bg-slatebrand-700 px-2 py-1 font-medium text-white hover:bg-slatebrand-600"
                  href={item.url_html_consolidada}
                  target="_blank"
                  rel="noreferrer"
                >
                  BOE consolidado
                </a>
              ) : null}
              {item.url_eli ? (
                <a
                  className="rounded-lg bg-slatebrand-100 px-2 py-1 font-medium text-slatebrand-800 hover:bg-slatebrand-200"
                  href={item.url_eli}
                  target="_blank"
                  rel="noreferrer"
                >
                  ELI
                </a>
              ) : null}
              {item.id_unidad ? (
                <button
                  type="button"
                  className="rounded-lg border border-slatebrand-200 px-2 py-1 font-medium text-slatebrand-800 hover:bg-slatebrand-100"
                  onClick={() => {
                    if (item.id_unidad) {
                      onViewUnidad?.(item.id_unidad);
                    }
                  }}
                >
                  Ver unidad completa
                </button>
              ) : null}
              <button
                type="button"
                className="rounded-lg border border-slatebrand-200 px-2 py-1 font-medium text-slatebrand-800 hover:bg-slatebrand-100"
                onClick={() => void handleCopy(item)}
              >
                {copiedId === item.id_chunk ? "Copiada" : "Copiar cita"}
              </button>
            </div>

            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slatebrand-800">{excerpt}</p>
            {hasMore ? (
              <button
                type="button"
                className="mt-2 text-xs font-semibold uppercase tracking-wide text-slatebrand-700 hover:text-slatebrand-900"
                onClick={() =>
                  setExpanded((prev) => ({
                    ...prev,
                    [item.id_chunk]: !isExpanded,
                  }))
                }
              >
                {isExpanded ? "Ver menos" : "Ver mas"}
              </button>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}
