import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { RagUnidadRecord } from "@boe/core/db/unidades";
import type { RagVectorHit } from "@boe/core/qdrant";
import { registerRagRoutes } from "../src/routes/rag";

function buildHit(input: {
  idChunk: string;
  idUnidad: string;
  idNorma: string;
  unidadRef: string;
  score: number;
  text: string;
}): RagVectorHit {
  return {
    idChunk: input.idChunk,
    score: input.score,
    text: input.text,
    meta: {
      id_unidad: input.idUnidad,
      id_norma: input.idNorma,
      unidad_tipo: "ARTICULO",
      unidad_ref: input.unidadRef,
      titulo: input.unidadRef,
      territorio: {
        codigo: "ES:STATE",
        tipo: "ESTATAL",
        nombre: "Espana (Estatal)",
      },
      fecha_vigencia_desde: "2025-01-01T00:00:00.000Z",
      fecha_vigencia_hasta: null,
      url_html_consolidada: `https://example.test/${input.idNorma}`,
      url_eli: `https://example.test/eli/${input.idNorma}`,
      tags: [],
    },
  };
}

function buildUnidad(input: {
  idUnidad: string;
  idNorma: string;
  unidadRef: string;
  text: string;
}): RagUnidadRecord {
  return {
    id_unidad: input.idUnidad,
    id_norma: input.idNorma,
    unidad_tipo: "ARTICULO",
    unidad_ref: input.unidadRef,
    titulo: input.unidadRef,
    texto_plano: input.text,
    fecha_vigencia_desde: new Date("2025-01-01T00:00:00.000Z"),
    fecha_vigencia_hasta: null,
    territorio: {
      codigo: "ES:STATE",
      tipo: "ESTATAL",
      nombre: "Espana (Estatal)",
    },
    url_html_consolidada: `https://example.test/${input.idNorma}`,
    url_eli: `https://example.test/eli/${input.idNorma}`,
  };
}

describe("rag answer route", () => {
  it("deduplicates id_unidad and builds prompt with hydrated unit texts", async () => {
    const embed = vi.fn(async () => [0.1, 0.2, 0.3]);
    const qdrantSearch = vi.fn(async () => ({
      qdrantTimeMs: 12,
      results: [
        buildHit({
          idChunk: "chunk-1",
          idUnidad: "U-1",
          idNorma: "BOE-A-1",
          unidadRef: "Art. 1",
          score: 0.91,
          text: "Extracto chunk 1 unidad 1",
        }),
        buildHit({
          idChunk: "chunk-2",
          idUnidad: "U-1",
          idNorma: "BOE-A-1",
          unidadRef: "Art. 1",
          score: 0.85,
          text: "Extracto chunk 2 unidad 1",
        }),
        buildHit({
          idChunk: "chunk-3",
          idUnidad: "U-2",
          idNorma: "BOE-A-2",
          unidadRef: "Art. 2",
          score: 0.8,
          text: "Extracto chunk unidad 2",
        }),
      ],
    }));

    const getUnidadesByIds = vi.fn(async () => [
      buildUnidad({
        idUnidad: "U-1",
        idNorma: "BOE-A-1",
        unidadRef: "Art. 1",
        text: "TEXTO COMPLETO U1",
      }),
      buildUnidad({
        idUnidad: "U-2",
        idNorma: "BOE-A-2",
        unidadRef: "Art. 2",
        text: "TEXTO COMPLETO U2",
      }),
    ]);
    const getUnidadById = vi.fn(async () => null);
    const complete = vi.fn(async () => "Respuesta generada por modelo.\n\nCitas:\n- (BOE-A-1, Art. 1)");

    const app = Fastify();
    await registerRagRoutes(app, {
      embedder: { embed },
      qdrant: { search: qdrantSearch } as never,
      unidadStore: { getUnidadesByIds, getUnidadById },
      answerModel: { complete },
      answerTopUnidades: 5,
      answerMaxUnidadChars: 6000,
      now: () => new Date("2026-02-11T10:00:00.000Z"),
    });

    const response = await app.inject({
      method: "POST",
      url: "/rag/answer",
      payload: {
        query: "Que dice la normativa sobre precios",
        scope: "ESTATAL",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(getUnidadesByIds).toHaveBeenCalledWith(["U-1", "U-2"]);
    expect(complete).toHaveBeenCalledTimes(1);

    const promptMessages = complete.mock.calls[0]?.[0] as Array<{ role: string; content: string }>;
    expect(promptMessages[1]?.content).toContain("TEXTO COMPLETO U1");
    expect(promptMessages[1]?.content).toContain("TEXTO COMPLETO U2");

    await app.close();
  });

  it("returns usedCitations including vigencia and URLs", async () => {
    const app = Fastify();
    await registerRagRoutes(app, {
      embedder: { embed: async () => [0.1, 0.2, 0.3] },
      qdrant: {
        search: async () => ({
          qdrantTimeMs: 9,
          results: [
            buildHit({
              idChunk: "chunk-cita",
              idUnidad: "U-9",
              idNorma: "BOE-A-9",
              unidadRef: "Art. 9",
              score: 0.75,
              text: "Texto de evidencia para cita",
            }),
          ],
        }),
      } as never,
      unidadStore: {
        getUnidadesByIds: async () => [],
        getUnidadById: async () => null,
      },
      answerModel: {
        complete: async () => "Respuesta.\n\nCitas:\n- (BOE-A-9, Art. 9)",
      },
      now: () => new Date("2026-02-11T10:00:00.000Z"),
    });

    const response = await app.inject({
      method: "POST",
      url: "/rag/answer",
      payload: {
        query: "Consulta normativa",
        scope: "ESTATAL",
      },
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.usedCitations).toHaveLength(1);
    expect(payload.usedCitations[0]).toMatchObject({
      id_unidad: "U-9",
      id_norma: "BOE-A-9",
      vigencia: {
        desde: "2025-01-01T00:00:00.000Z",
        hasta: null,
      },
      url_html_consolidada: "https://example.test/BOE-A-9",
      url_eli: "https://example.test/eli/BOE-A-9",
    });

    await app.close();
  });
});
