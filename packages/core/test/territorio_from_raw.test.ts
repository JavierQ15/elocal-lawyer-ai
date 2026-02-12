import { describe, expect, it } from "vitest";
import { normalizeTerritorioFromRaw } from "../src/utils/territorio";

describe("test_territorio_from_raw", () => {
  it("normaliza estatal", () => {
    const result = normalizeTerritorioFromRaw({
      ambito: { codigo: "1", texto: "Estatal" },
      departamento: { codigo: "7723", texto: "Jefatura del Estado" },
    });

    expect(result.ambito_codigo).toBe("1");
    expect(result.departamento_codigo).toBe("7723");
    expect(result.territorio.tipo).toBe("ESTATAL");
    expect(result.territorio.codigo).toBe("ES:STATE");
    expect(result.territorio.nombre).toBe("España (Estatal)");
  });

  it("normaliza autonomico", () => {
    const result = normalizeTerritorioFromRaw({
      ambito: { codigo: "2", texto: "Autonomico" },
      departamento: { codigo: "8070", texto: "Comunidad Autonoma de Cataluna" },
    });

    expect(result.ambito_codigo).toBe("2");
    expect(result.departamento_codigo).toBe("8070");
    expect(result.territorio.tipo).toBe("AUTONOMICO");
    expect(result.territorio.codigo).toBe("CCAA:8070");
    expect(result.territorio.nombre).toBe("Comunidad Autonoma de Cataluna");
  });
});
