import { describe, expect, it } from "vitest";
import { buildUnidadId, buildUnidadLineageKey, buildTextoHash } from "../../src/semantic/unitBuilder";

describe("semantic unit idempotency", () => {
  it("generates stable unit ids for same input", () => {
    const textoHash = buildTextoHash("Artículo 1. Texto de prueba.");

    const first = buildUnidadId({
      id_norma: "BOE-A-2023-7500",
      unidad_tipo: "ARTICULO",
      unidad_ref: "Art. 1",
      fecha_vigencia_desde: new Date("2023-04-12T00:00:00.000Z"),
      id_norma_modificadora: null,
      texto_hash: textoHash,
    });

    const second = buildUnidadId({
      id_norma: "BOE-A-2023-7500",
      unidad_tipo: "ARTICULO",
      unidad_ref: "Art. 1",
      fecha_vigencia_desde: new Date("2023-04-12T00:00:00.000Z"),
      id_norma_modificadora: null,
      texto_hash: textoHash,
    });

    expect(first).toBe(second);
  });

  it("changes id when text hash changes but keeps lineage", () => {
    const first = buildUnidadId({
      id_norma: "BOE-A-2023-7500",
      unidad_tipo: "ARTICULO",
      unidad_ref: "Art. 1",
      fecha_vigencia_desde: new Date("2023-04-12T00:00:00.000Z"),
      id_norma_modificadora: null,
      texto_hash: buildTextoHash("texto A"),
    });

    const second = buildUnidadId({
      id_norma: "BOE-A-2023-7500",
      unidad_tipo: "ARTICULO",
      unidad_ref: "Art. 1",
      fecha_vigencia_desde: new Date("2023-04-12T00:00:00.000Z"),
      id_norma_modificadora: null,
      texto_hash: buildTextoHash("texto B"),
    });

    const lineageA = buildUnidadLineageKey({
      id_norma: "BOE-A-2023-7500",
      unidad_tipo: "ARTICULO",
      unidad_ref: "Art. 1",
    });

    const lineageB = buildUnidadLineageKey({
      id_norma: "BOE-A-2023-7500",
      unidad_tipo: "ARTICULO",
      unidad_ref: "Art. 1",
    });

    expect(first).not.toBe(second);
    expect(lineageA).toBe(lineageB);
  });
});
