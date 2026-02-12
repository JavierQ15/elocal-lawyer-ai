import { describe, expect, it, vi } from "vitest";
import type { AppServices } from "../src/services";
import { runBuildChunks } from "../src/commands/buildChunks";
import type { UnidadDoc } from "@boe/core/semantic/contracts";

function buildUnidad(partial: Partial<UnidadDoc> & { id_unidad: string }): UnidadDoc {
  const now = new Date("2026-01-01T00:00:00.000Z");

  return {
    _id: partial.id_unidad,
    id_unidad: partial.id_unidad,
    id_norma: partial.id_norma ?? "BOE-A-TEST",
    unidad_tipo: partial.unidad_tipo ?? "ARTICULO",
    unidad_ref: partial.unidad_ref ?? "Art. 1",
    titulo: partial.titulo ?? "Articulo 1",
    orden: partial.orden ?? 1,
    fecha_vigencia_desde: partial.fecha_vigencia_desde ?? now,
    fecha_vigencia_hasta: partial.fecha_vigencia_hasta ?? null,
    fecha_publicacion_mod: partial.fecha_publicacion_mod ?? null,
    id_norma_modificadora: partial.id_norma_modificadora ?? null,
    texto_plano:
      partial.texto_plano ??
      "Articulo 1. Contenido.\n\n1. Texto de ejemplo suficiente para generar chunk semantico.",
    texto_hash: partial.texto_hash ?? "hash",
    n_chars: partial.n_chars ?? 90,
    source: partial.source ?? {
      metodo: "merge_bloques",
      bloques_origen: [],
      indice_hash: "idx-hash",
      version_hashes: ["v-hash"],
    },
    metadata: partial.metadata ?? {
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
    quality: partial.quality,
    lineage_key: partial.lineage_key ?? "lineage",
    created_at: partial.created_at ?? now,
    last_seen_at: partial.last_seen_at ?? now,
    is_latest: partial.is_latest ?? true,
  };
}

describe("runBuildChunks quality skip", () => {
  it("does not generate chunks for heading-only units (quality or fallback detection)", async () => {
    const skipUnidad = buildUnidad({
      id_unidad: "U-SKIP",
      quality: {
        is_heading_only: true,
        skip_retrieval: true,
        reason: "heading_only",
      },
      texto_plano: "Articulo 20\n\nArticulo 20. De la calidad del sistema.",
    });

    const skipByFallbackUnidad = buildUnidad({
      id_unidad: "U-SKIP-FALLBACK",
      quality: undefined,
      texto_plano: "Articulo 30\n\nArticulo 30. Del titulo.",
    });

    const normalUnidad = buildUnidad({
      id_unidad: "U-KEEP",
      quality: {
        is_heading_only: false,
        skip_retrieval: false,
        reason: null,
      },
      texto_plano:
        "Articulo 21. Del control.\n\n1. La Administracion establecera mecanismos de seguimiento.",
    });

    const unidades = [skipUnidad, skipByFallbackUnidad, normalUnidad];
    const updateOne = vi.fn(async () => ({ upsertedCount: 1 }));
    const deleteMany = vi.fn(async () => ({ deletedCount: 0 }));

    const services = {
      config: {
        requestConcurrency: 1,
        chunkMethod: "simple",
        chunkSize: 1000,
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
                toArray: async () => unidades,
              }),
            };
          }

          if (name === "chunks_semanticos") {
            return {
              countDocuments: vi.fn(async () => 0),
              updateMany: vi.fn(async () => ({ modifiedCount: 0 })),
              updateOne,
              deleteMany,
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
      chunkSize: 1000,
      overlap: 0,
    });

    expect(stats.unidadesSeen).toBe(3);
    expect(stats.unidadesSkippedQuality).toBe(1);
    expect(stats.skippedHeadingOnlyChunks).toBe(1);
    expect(stats.generatedChunks).toBe(1);
    expect(updateOne).toHaveBeenCalledTimes(1);
    expect(deleteMany).toHaveBeenCalledTimes(2);
    expect(updateOne.mock.calls[0]?.[1]?.$set?.id_unidad).toBe("U-KEEP");
    expect(updateOne.mock.calls[0]?.[1]?.$set?.metadata?.fecha_vigencia_hasta).toBeNull();
    expect(stats.chunksWithVigenciaHasta).toBe(1);
  });
});
