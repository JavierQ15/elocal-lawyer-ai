import { describe, expect, it } from "vitest";
import { isHeadingOnlyChunk } from "../src/commands/buildChunks";

describe("isHeadingOnlyChunk", () => {
  it("returns true for heading-only articulo chunk", () => {
    const chunkText = "Articulo 20\n\nArticulo 20. De la calidad del sistema.";
    expect(isHeadingOnlyChunk("ARTICULO", chunkText)).toBe(true);
  });

  it("returns false for articulo chunk with body", () => {
    const chunkText =
      "Articulo 20. De la calidad del sistema.\n\n1. La Administracion debera implantar controles.";
    expect(isHeadingOnlyChunk("ARTICULO", chunkText)).toBe(false);
  });

  it("returns true for heading-only disposicion final", () => {
    const chunkText =
      "Disposicion final decimoctava\n\nDisposicion final decimoctava. Entrada en vigor.";
    expect(isHeadingOnlyChunk("DISPOSICION_FINAL", chunkText)).toBe(true);
  });
});
