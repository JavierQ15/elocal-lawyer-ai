import { describe, expect, it } from "vitest";
import { buildTemplateUrl } from "../src/config";

describe("buildTemplateUrl", () => {
  it("does not encode base URL", () => {
    const url = buildTemplateUrl("{base}/id/{id_norma}/texto/indice", {
      base: "https://www.boe.es/datosabiertos/api/legislacion-consolidada",
      id_norma: "BOE-A-2020-8099",
    });

    expect(url).toBe(
      "https://www.boe.es/datosabiertos/api/legislacion-consolidada/id/BOE-A-2020-8099/texto/indice",
    );
  });

  it("encodes non-base placeholders", () => {
    const url = buildTemplateUrl("{base}/id/{id_norma}/texto/bloque/{id_bloque}", {
      base: "https://www.boe.es/datosabiertos/api/legislacion-consolidada/",
      id_norma: "BOE-A-2020-8099",
      id_bloque: "anexo especial",
    });

    expect(url).toBe(
      "https://www.boe.es/datosabiertos/api/legislacion-consolidada/id/BOE-A-2020-8099/texto/bloque/anexo%20especial",
    );
  });
});
