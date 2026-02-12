import { describe, expect, it, vi } from "vitest";
import type { AppServices } from "../src/services";
import { runBuildChunks } from "../src/commands/buildChunks";
import type { UnidadDoc } from "@boe/core/semantic/contracts";

function buildUnidadForSingleChunkTest(): UnidadDoc {
  const now = new Date("2026-01-01T00:00:00.000Z");

  return {
    _id: "U-ART-1",
    id_unidad: "U-ART-1",
    id_norma: "BOE-A-TEST",
    unidad_tipo: "ARTICULO",
    unidad_ref: "Art. 5",
    titulo: "Articulo 5",
    orden: 1,
    fecha_vigencia_desde: now,
    fecha_vigencia_hasta: null,
    fecha_publicacion_mod: null,
    id_norma_modificadora: null,
    texto_plano:
      "Articulo 5. Texto de prueba con varios apartados.\n\n1. Primer apartado.\n\n2. Segundo apartado.\n\n3. Tercer apartado.",
    texto_hash: "hash-art-5",
    // Simulamos un n_chars inferior al chunk_size para forzar la regla.
    n_chars: 80,
    source: {
      metodo: "merge_bloques",
      bloques_origen: [],
      indice_hash: "idx-hash",
      version_hashes: ["v-hash"],
    },
    metadata: {
      rango_texto: "Ley",
      ambito_texto: "Estatal",
      ambito_codigo: "EST",
      departamento_codigo: "DEP",
      departamento_texto: "Departamento",
      territorio: {
        tipo: "ESTATAL",
        codigo: "ES:STATE",
        nombre: "Espana (Estatal)",
      },
      url_html_consolidada: "https://example.test/norma",
      url_eli: "https://example.test/eli",
      tags: [],
    },
    quality: {
      is_heading_only: false,
      skip_retrieval: false,
      reason: null,
    },
    lineage_key: "lineage-art-5",
    created_at: now,
    last_seen_at: now,
    is_latest: true,
  };
}

describe("runBuildChunks articulo small unit rule", () => {
  it("keeps articulo as single chunk when n_chars <= chunk_size", async () => {
    const unidad = buildUnidadForSingleChunkTest();
    const updateOne = vi.fn(async () => ({ upsertedCount: 1 }));

    const services = {
      config: {
        requestConcurrency: 1,
        chunkMethod: "simple",
        chunkSize: 100,
        chunkOverlap: 0,
      },
      logger: {
        info: vi.fn(),
        error: vi.fn(),
      },
      db: {
        collection: (name: string) => {
          if (name === "unidades") {
            return {
              find: () => ({
                toArray: async () => [unidad],
              }),
            };
          }

          if (name === "chunks_semanticos") {
            return {
              countDocuments: vi.fn(async () => 0),
              updateOne,
              deleteMany: vi.fn(async () => ({ deletedCount: 0 })),
            };
          }

          throw new Error(`Unexpected collection: ${name}`);
        },
      },
      dryRun: false,
      client: {} as never,
      fsStore: {} as never,
      repos: {} as never,
    } as unknown as AppServices;

    const stats = await runBuildChunks(services, {
      all: true,
      concurrency: 1,
      method: "simple",
      chunkSize: 100,
      overlap: 0,
    });

    expect(stats.generatedChunks).toBe(1);
    expect(updateOne).toHaveBeenCalledTimes(1);
    expect(updateOne.mock.calls[0]?.[1]?.$set?.texto).toBe(unidad.texto_plano);
  });
});
