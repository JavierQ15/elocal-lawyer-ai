import { describe, expect, it } from "vitest";
import {
  INFINITE_VIGENCIA_HASTA_MS,
  buildRagFilter,
  toQdrantVigenciaHastaMs,
} from "../src/vector/qdrant";

describe("qdrant temporal filter", () => {
  it("builds [desde, hasta) temporal constraints using sentinel semantics", () => {
    const asOfMs = Date.parse("2026-02-11T00:00:00.000Z");
    const filter = buildRagFilter({
      asOfMs,
      mode: "NORMATIVO",
      includePreambulo: false,
    });

    expect(filter.must).toEqual(
      expect.arrayContaining([
        { key: "vigencia_desde", range: { lte: asOfMs } },
        { key: "vigencia_hasta", range: { gt: asOfMs } },
      ]),
    );
  });

  it("maps null vigencia_hasta to sentinel", () => {
    expect(toQdrantVigenciaHastaMs(null)).toBe(INFINITE_VIGENCIA_HASTA_MS);
    expect(toQdrantVigenciaHastaMs(undefined)).toBe(INFINITE_VIGENCIA_HASTA_MS);
  });

  it("builds territorial any filter when multiple territorios are allowed", () => {
    const filter = buildRagFilter({
      asOfMs: Date.parse("2026-02-11T00:00:00.000Z"),
      territorios: ["ES:STATE", "CCAA:8140"],
      mode: "NORMATIVO",
      includePreambulo: false,
    });

    expect(filter.must).toEqual(
      expect.arrayContaining([
        {
          key: "territorio_codigo",
          match: { any: ["ES:STATE", "CCAA:8140"] },
        },
      ]),
    );
  });
});
