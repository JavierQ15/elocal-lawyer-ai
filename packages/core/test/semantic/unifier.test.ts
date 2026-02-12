import { describe, expect, it } from "vitest";
import { composeSemanticUnitText } from "../../src/semantic/unitBuilder";

describe("semantic unifier", () => {
  it("merges header and ordered block texts into one unit", () => {
    const text = composeSemanticUnitText({
      header: "Artículo 14",
      blocks: [
        {
          id_bloque: "a14",
          titulo_bloque: "Artículo 14",
          texto_plano: "Artículo 14. Objeto.",
          order: 10,
        },
        {
          id_bloque: "a14-1",
          titulo_bloque: "Apartado 1",
          texto_plano: "1. Primer apartado.",
          order: 11,
        },
        {
          id_bloque: "a14-2",
          titulo_bloque: "Apartado 2",
          texto_plano: "2. Segundo apartado.",
          order: 12,
        },
      ],
    });

    expect(text).toContain("Artículo 14. Objeto.");
    expect(text).toContain("1. Primer apartado.");
    expect(text).toContain("2. Segundo apartado.");
    expect(text.indexOf("1. Primer apartado.")).toBeLessThan(text.indexOf("2. Segundo apartado."));
  });
});
