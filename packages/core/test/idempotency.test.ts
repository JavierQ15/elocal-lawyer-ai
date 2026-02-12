import { describe, expect, it } from "vitest";
import { buildIndiceId, buildVersionId } from "../src/utils/ids";

describe("idempotency ids", () => {
  it("builds stable indice ids for same input", () => {
    const a = buildIndiceId({
      idNorma: "BOE-A-2020-8099",
      fechaActualizacionIndiceRaw: "20221115",
      hashXml: "abc123",
    });

    const b = buildIndiceId({
      idNorma: "BOE-A-2020-8099",
      fechaActualizacionIndiceRaw: "20221115",
      hashXml: "abc123",
    });

    expect(a).toBe(b);
  });

  it("builds stable version ids and changes with content hash", () => {
    const a = buildVersionId({
      idNorma: "BOE-A-2020-8099",
      idBloque: "a1",
      fechaVigenciaDesdeRaw: "20200731",
      idNormaModificadora: "BOE-A-2020-8847",
      hashXml: "hash-one",
    });

    const b = buildVersionId({
      idNorma: "BOE-A-2020-8099",
      idBloque: "a1",
      fechaVigenciaDesdeRaw: "20200731",
      idNormaModificadora: "BOE-A-2020-8847",
      hashXml: "hash-one",
    });

    const c = buildVersionId({
      idNorma: "BOE-A-2020-8099",
      idBloque: "a1",
      fechaVigenciaDesdeRaw: "20200731",
      idNormaModificadora: "BOE-A-2020-8847",
      hashXml: "hash-two",
    });

    expect(a).toBe(b);
    expect(c).not.toBe(a);
  });
});
