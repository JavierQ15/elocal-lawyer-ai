export type TerritorioTipo = "ESTATAL" | "AUTONOMICO";

export interface TerritorioNormalized {
  tipo: TerritorioTipo;
  codigo: string;
  nombre: string;
}

export interface TerritorioFromRaw {
  ambito_codigo: string | null;
  departamento_codigo: string | null;
  territorio: TerritorioNormalized;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function pickCodigo(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }

  const record = toRecord(value);
  const codigo = record.codigo;

  if (typeof codigo === "string") {
    return codigo;
  }

  if (typeof codigo === "number") {
    return String(codigo);
  }

  return null;
}

function pickTexto(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }

  const record = toRecord(value);
  const texto = record.texto;

  if (typeof texto === "string") {
    return texto;
  }

  return null;
}

function looksEstatal(ambitoCodigo: string | null, ambitoTexto: string | null): boolean {
  if (ambitoCodigo === "1") {
    return true;
  }

  if (!ambitoTexto) {
    return false;
  }

  return /estatal/i.test(ambitoTexto);
}

export function normalizeTerritorioFromRaw(rawItemJson: Record<string, unknown>): TerritorioFromRaw {
  const ambito = toRecord(rawItemJson).ambito;
  const departamento = toRecord(rawItemJson).departamento;

  const ambitoCodigo = pickCodigo(ambito);
  const ambitoTexto = pickTexto(ambito);
  const departamentoCodigo = pickCodigo(departamento);
  const departamentoTexto = pickTexto(departamento);

  if (looksEstatal(ambitoCodigo, ambitoTexto)) {
    return {
      ambito_codigo: ambitoCodigo,
      departamento_codigo: departamentoCodigo,
      territorio: {
        tipo: "ESTATAL",
        codigo: "ES:STATE",
        nombre: "España (Estatal)",
      },
    };
  }

  return {
    ambito_codigo: ambitoCodigo,
    departamento_codigo: departamentoCodigo,
    territorio: {
      tipo: "AUTONOMICO",
      codigo: `CCAA:${departamentoCodigo ?? "UNKNOWN"}`,
      nombre: departamentoTexto ?? "Comunidad Autonoma",
    },
  };
}

export function normalizeTerritorioValue(
  territorio: TerritorioNormalized | null | undefined,
): TerritorioNormalized {
  if (!territorio) {
    return {
      tipo: "ESTATAL",
      codigo: "ES:STATE",
      nombre: "España (Estatal)",
    };
  }

  if (territorio.tipo === "ESTATAL") {
    return {
      tipo: "ESTATAL",
      codigo: "ES:STATE",
      nombre: territorio.nombre || "España (Estatal)",
    };
  }

  const codigo = territorio.codigo?.startsWith("CCAA:")
    ? territorio.codigo
    : `CCAA:${territorio.codigo ?? "UNKNOWN"}`;

  return {
    tipo: "AUTONOMICO",
    codigo,
    nombre: territorio.nombre || "Comunidad Autonoma",
  };
}
