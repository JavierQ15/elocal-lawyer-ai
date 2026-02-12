import { describe, expect, it } from "vitest";
import { shouldKeepSemanticUnit } from "../../src/semantic/unitBuilder";

describe("semantic unit filter", () => {
  it("filters short noisy blocks", () => {
    const result = shouldKeepSemanticUnit({
      unidad_tipo: "OTROS",
      texto_plano: "Nota: redacción anterior.",
      hasChildrenWithContent: false,
      looksNoise: true,
    });

    expect(result.keep).toBe(false);
    expect(result.reason).toBe("too_short");
  });

  it("keeps long noisy text as OTROS", () => {
    const result = shouldKeepSemanticUnit({
      unidad_tipo: "OTROS",
      texto_plano: "A".repeat(600),
      hasChildrenWithContent: false,
      looksNoise: true,
    });

    expect(result.keep).toBe(true);
    expect(result.unidad_tipo).toBe("OTROS");
    expect(result.reason).toBe("noise_promoted_to_otros");
  });
});
