import { describe, expect, it } from "vitest";
import { parseRagSearchRequest, resolveTerritorialFilter } from "../src/routes/rag";

describe("rag request validation", () => {
  it("applies defaults and normalizes asOf to UTC day start", () => {
    const parsed = parseRagSearchRequest(
      {
        query: "Que regula el articulo 20",
      },
      () => new Date("2026-02-11T19:23:00.000Z"),
    );

    expect(parsed.mode).toBe("NORMATIVO");
    expect(parsed.topK).toBe(8);
    expect(parsed.minScore).toBe(0);
    expect(parsed.includePreambulo).toBe(false);
    expect(parsed.asOf.toISOString()).toBe("2026-02-11T00:00:00.000Z");
  });

  it("rejects invalid body", () => {
    expect(() =>
      parseRagSearchRequest({
        query: "ab",
        topK: 200,
      }),
    ).toThrow();
  });

  it("parses scope ESTATAL and applies ES:STATE filter", () => {
    const parsed = parseRagSearchRequest({
      query: "tributos autonómicos",
      scope: "ESTATAL",
    });

    expect(parsed.scope).toBe("ESTATAL");
    expect(resolveTerritorialFilter(parsed)).toEqual({
      territorios: ["ES:STATE"],
    });
  });

  it("parses AUTONOMICO_MAS_ESTATAL with ccaaCodigo and applies mixed filter", () => {
    const parsed = parseRagSearchRequest({
      query: "sucesiones en comunidad",
      scope: "AUTONOMICO_MAS_ESTATAL",
      ccaaCodigo: "CCAA:8140",
    });

    expect(parsed.scope).toBe("AUTONOMICO_MAS_ESTATAL");
    expect(parsed.ccaaCodigo).toBe("CCAA:8140");
    expect(resolveTerritorialFilter(parsed)).toEqual({
      territorios: ["ES:STATE", "CCAA:8140"],
    });
  });

  it("requires ccaaCodigo when AUTONOMICO_MAS_ESTATAL is selected", () => {
    expect(() =>
      parseRagSearchRequest({
        query: "normativa autonómica",
        scope: "AUTONOMICO_MAS_ESTATAL",
      }),
    ).toThrow(/ccaaCodigo is required/);
  });

  it("keeps backward compatibility with territorio when scope is omitted", () => {
    const parsed = parseRagSearchRequest({
      query: "consulta legacy",
      territorio: "CCAA:8140",
    });

    expect(parsed.scope).toBeUndefined();
    expect(parsed.territorio).toBe("CCAA:8140");
    expect(resolveTerritorialFilter(parsed)).toEqual({
      territorio: "CCAA:8140",
    });
  });

  it("prioritizes scope over territorio when both are provided", () => {
    const parsed = parseRagSearchRequest({
      query: "precedencia scope",
      scope: "ESTATAL",
      territorio: "CCAA:8140",
    });

    expect(resolveTerritorialFilter(parsed)).toEqual({
      territorios: ["ES:STATE"],
    });
  });
});
