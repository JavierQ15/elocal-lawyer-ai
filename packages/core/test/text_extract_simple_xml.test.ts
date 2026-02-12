import { describe, expect, it } from "vitest";
import { extractPlainTextFromXml } from "../src/utils/ragText";

describe("test_text_extract_simple_xml", () => {
  it("extrae texto plano legible", () => {
    const xml = `
      <version id_norma="BOE-A-2020-8099" fecha_publicacion="20200718" fecha_vigencia="20200722">
        <p class="articulo">Articulo 1. Objeto.</p>
        <p class="parrafo">Primer parrafo con &amp; entidad.</p>
        <blockquote>
          <p class="nota_pie">Nota de pie.</p>
        </blockquote>
      </version>
    `;

    const text = extractPlainTextFromXml(xml, "fastxml");

    expect(text).toContain("Articulo 1. Objeto.");
    expect(text).toContain("Primer parrafo con & entidad.");
    expect(text).toContain("Nota de pie.");
    expect(text).toContain("\n\n");
  });
});
