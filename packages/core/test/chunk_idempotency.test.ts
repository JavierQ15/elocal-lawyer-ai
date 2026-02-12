import { describe, expect, it } from "vitest";
import { buildVersionChunks } from "../src/utils/ragText";

describe("test_chunk_idempotency", () => {
  it("mismo input produce mismos ids", () => {
    const params = {
      id_version: "version-123",
      texto_plano:
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
      chunking: {
        method: "simple" as const,
        chunk_size: 50,
        overlap: 10,
      },
    };

    const first = buildVersionChunks(params);
    const second = buildVersionChunks(params);

    expect(first.map((item) => item.id_chunk)).toEqual(second.map((item) => item.id_chunk));
    expect(first.map((item) => item.texto_hash)).toEqual(second.map((item) => item.texto_hash));
  });
});
