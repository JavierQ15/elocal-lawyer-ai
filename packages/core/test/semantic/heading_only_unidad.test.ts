import { describe, expect, it } from "vitest";
import { isHeadingOnlyUnidad } from "../../src/semantic/unitBuilder";

describe("isHeadingOnlyUnidad", () => {
  it("marks heading-only article as true", () => {
    const text = "Articulo 20\n\nArticulo 20. De la calidad del sistema.";
    expect(isHeadingOnlyUnidad("ARTICULO", text)).toBe(true);
  });

  it("keeps article with numbered sections", () => {
    const text =
      "Articulo 20. De la calidad del sistema.\n\n1. La Administracion...\n2. Desarrollo reglamentario.";
    expect(isHeadingOnlyUnidad("ARTICULO", text)).toBe(false);
  });

  it("keeps article with inciso content", () => {
    const text = "Articulo 3. Definiciones.\n\na) Sistema.\nb) Servicio.";
    expect(isHeadingOnlyUnidad("ARTICULO", text)).toBe(false);
  });

  it("applies equivalent behavior to disposiciones", () => {
    const text = "Disposicion adicional primera\nDisposicion adicional primera. Regimen aplicable.";
    expect(isHeadingOnlyUnidad("DISPOSICION_ADICIONAL", text)).toBe(true);
  });

  it("does not apply to preambulo", () => {
    const text = "Preambulo\nTexto breve";
    expect(isHeadingOnlyUnidad("PREAMBULO", text)).toBe(false);
  });
});
