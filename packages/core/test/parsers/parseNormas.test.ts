import { describe, expect, it } from "vitest";
import fixture from "../fixtures/discover-response.json";
import { parseNormasResponse } from "../../src/parsers/parseNormas";

describe("parseNormasResponse", () => {
  it("parses nested data[] fields", () => {
    const parsed = parseNormasResponse(fixture as any);

    expect(parsed).toHaveLength(2);
    expect(parsed[0].id_norma).toBe("BOE-A-2015-10566");
    expect(parsed[0].rango_texto).toBe("Ley");
    expect(parsed[0].departamento_texto).toBe("Jefatura del Estado");
    expect(parsed[0].ambito_texto).toBe("Estatal");
    expect(parsed[0].ambito_codigo).toBe("1");
    expect(parsed[0].departamento_codigo).toBe("7723");
    expect(parsed[0].territorio.tipo).toBe("ESTATAL");
    expect(parsed[0].territorio.codigo).toBe("ES:STATE");
    expect(parsed[0].fecha_actualizacion?.toISOString()).toBe("2022-11-15T11:57:48.000Z");
    expect(parsed[0].fecha_publicacion?.toISOString()).toBe("2015-10-02T00:00:00.000Z");
  });
});
