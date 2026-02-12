import type { CcaaOption, SearchFiltersState } from "../types";

interface FiltersProps {
  value: SearchFiltersState;
  disabled: boolean;
  ccaaOptions: CcaaOption[];
  ccaaLoading: boolean;
  ccaaError: string | null;
  onChange: (next: SearchFiltersState) => void;
}

function updateFilter<K extends keyof SearchFiltersState>(
  current: SearchFiltersState,
  key: K,
  nextValue: SearchFiltersState[K],
): SearchFiltersState {
  return {
    ...current,
    [key]: nextValue,
  };
}

export function Filters({ value, disabled, ccaaOptions, ccaaLoading, ccaaError, onChange }: FiltersProps) {
  return (
    <section className="flex h-full flex-col rounded-3xl border border-slatebrand-200 bg-white/95 p-5 shadow-panel backdrop-blur">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slatebrand-700">Filtros</h2>

      <div className="mt-4 space-y-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slatebrand-800">As-of date</span>
          <input
            type="date"
            className="w-full rounded-xl border border-slatebrand-200 bg-slatebrand-50 px-3 py-2 text-sm text-slatebrand-900 outline-none transition focus:border-slatebrand-400"
            value={value.asOf}
            disabled={disabled}
            onChange={(event) => onChange(updateFilter(value, "asOf", event.target.value))}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slatebrand-800">Modo</span>
          <select
            className="w-full rounded-xl border border-slatebrand-200 bg-slatebrand-50 px-3 py-2 text-sm text-slatebrand-900 outline-none transition focus:border-slatebrand-400"
            value={value.mode}
            disabled={disabled}
            onChange={(event) =>
              onChange(updateFilter(value, "mode", event.target.value as SearchFiltersState["mode"]))
            }
          >
            <option value="NORMATIVO">NORMATIVO</option>
            <option value="VIGENCIA">VIGENCIA</option>
            <option value="MIXTO">MIXTO</option>
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slatebrand-800">Ambito</span>
          <select
            className="w-full rounded-xl border border-slatebrand-200 bg-slatebrand-50 px-3 py-2 text-sm text-slatebrand-900 outline-none transition focus:border-slatebrand-400"
            value={value.scope}
            disabled={disabled}
            onChange={(event) =>
              onChange(updateFilter(value, "scope", event.target.value as SearchFiltersState["scope"]))
            }
          >
            <option value="ESTATAL">ESTATAL</option>
            <option value="AUTONOMICO_MAS_ESTATAL">AUTONOMICO (+ ESTATAL)</option>
          </select>
        </label>

        {value.scope === "AUTONOMICO_MAS_ESTATAL" ? (
          <div className="space-y-2 rounded-2xl border border-slatebrand-100 bg-slatebrand-50 p-3">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slatebrand-800">CCAA</span>
              <select
                className="w-full rounded-xl border border-slatebrand-200 bg-white px-3 py-2 text-sm text-slatebrand-900 outline-none transition focus:border-slatebrand-400"
                value={value.ccaaCodigo}
                disabled={disabled || ccaaLoading}
                onChange={(event) => onChange(updateFilter(value, "ccaaCodigo", event.target.value))}
              >
                <option value="">Selecciona codigo CCAA</option>
                {ccaaOptions.map((option) => (
                  <option key={option.codigo} value={option.codigo}>
                    {option.nombre} ({option.codigo})
                  </option>
                ))}
              </select>
              {ccaaLoading ? (
                <span className="mt-1 block text-xs text-slatebrand-600">Cargando CCAA...</span>
              ) : null}
              {ccaaError ? (
                <span className="mt-1 block text-xs text-amber-700">
                  No se pudo cargar catalogo CCAA. Puedes escribir el codigo manualmente.
                </span>
              ) : null}
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slatebrand-600">
                Codigo manual (si no aparece en la lista)
              </span>
              <input
                type="text"
                placeholder="CCAA:8140"
                className="w-full rounded-xl border border-slatebrand-200 bg-white px-3 py-2 text-sm text-slatebrand-900 outline-none transition focus:border-slatebrand-400"
                value={value.ccaaCodigo}
                disabled={disabled}
                onChange={(event) => onChange(updateFilter(value, "ccaaCodigo", event.target.value))}
              />
            </label>
          </div>
        ) : null}

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slatebrand-800">TopK ({value.topK})</span>
          <input
            type="range"
            min={3}
            max={15}
            step={1}
            value={value.topK}
            disabled={disabled}
            className="w-full accent-slatebrand-600"
            onChange={(event) => onChange(updateFilter(value, "topK", Number(event.target.value)))}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slatebrand-800">
            MinScore ({value.minScore.toFixed(2)})
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={value.minScore}
            disabled={disabled}
            className="w-full accent-slatebrand-600"
            onChange={(event) => onChange(updateFilter(value, "minScore", Number(event.target.value)))}
          />
        </label>

        <label className="flex cursor-pointer items-center justify-between rounded-xl border border-slatebrand-100 bg-slatebrand-50 px-3 py-2">
          <span className="text-sm font-medium text-slatebrand-800">Incluir preambulo</span>
          <input
            type="checkbox"
            checked={value.includePreambulo}
            disabled={disabled}
            className="h-4 w-4 accent-slatebrand-600"
            onChange={(event) => onChange(updateFilter(value, "includePreambulo", event.target.checked))}
          />
        </label>
      </div>
    </section>
  );
}
