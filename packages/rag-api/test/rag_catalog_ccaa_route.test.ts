import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerRagRoutes } from "../src/routes/rag";

describe("rag ccaa catalog route", () => {
  it("returns CCAA options from territorioStore", async () => {
    const listAutonomicos = vi.fn(async () => [
      { codigo: "CCAA:8011", nombre: "Andalucia" },
      { codigo: "CCAA:8140", nombre: "Comunidad de Madrid" },
    ]);

    const app = Fastify();
    await registerRagRoutes(app, {
      embedder: { embed: async () => [0.1, 0.2, 0.3] },
      qdrant: {
        search: async () => ({
          qdrantTimeMs: 0,
          results: [],
        }),
      } as never,
      territorioStore: { listAutonomicos },
    });

    const response = await app.inject({
      method: "GET",
      url: "/rag/catalog/ccaa",
    });

    expect(response.statusCode).toBe(200);
    expect(listAutonomicos).toHaveBeenCalledTimes(1);
    expect(response.json()).toEqual({
      items: [
        { codigo: "CCAA:8011", nombre: "Andalucia" },
        { codigo: "CCAA:8140", nombre: "Comunidad de Madrid" },
      ],
    });

    await app.close();
  });

  it("returns 503 when territorioStore is missing", async () => {
    const app = Fastify();
    await registerRagRoutes(app, {
      embedder: { embed: async () => [0.1, 0.2, 0.3] },
      qdrant: {
        search: async () => ({
          qdrantTimeMs: 0,
          results: [],
        }),
      } as never,
    });

    const response = await app.inject({
      method: "GET",
      url: "/rag/catalog/ccaa",
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      error: "RAG_CCAA_CATALOG_NOT_READY",
    });

    await app.close();
  });
});
