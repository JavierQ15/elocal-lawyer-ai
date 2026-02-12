import { Command } from "commander";
import type { AppServices } from "../services";
import type { ChunkSemanticoDoc, UnidadDoc } from "@boe/core/semantic/contracts";

interface RagCheckOptions {
  idNorma: string;
}

function formatUnit(unit: UnidadDoc): Record<string, unknown> {
  return {
    id_unidad: unit.id_unidad,
    tipo: unit.unidad_tipo,
    ref: unit.unidad_ref,
    titulo: unit.titulo,
    n_chars: unit.n_chars,
    vigencia: unit.fecha_vigencia_desde?.toISOString().slice(0, 10) ?? null,
    is_latest: unit.is_latest,
  };
}

function formatChunk(chunk: ChunkSemanticoDoc): Record<string, unknown> {
  return {
    id: chunk._id,
    id_unidad: chunk.id_unidad,
    chunk_index: chunk.chunk_index,
    n_chars: chunk.texto.length,
    tipo: chunk.metadata.unidad_tipo,
    ref: chunk.metadata.unidad_ref,
    preview: chunk.texto.slice(0, 140),
  };
}

export async function runRagCheck(services: AppServices, options: RagCheckOptions): Promise<void> {
  const unidadesCollection = services.db.collection<UnidadDoc>("unidades");
  const chunksCollection = services.db.collection<ChunkSemanticoDoc>("chunks_semanticos");

  const totalUnits = await unidadesCollection.countDocuments({ id_norma: options.idNorma });
  const latestUnits = await unidadesCollection.countDocuments({
    id_norma: options.idNorma,
    is_latest: true,
  });

  const shortest = await unidadesCollection.countDocuments({
    id_norma: options.idNorma,
    is_latest: true,
    n_chars: { $lt: 200 },
  });

  const topLongest = await unidadesCollection
    .find({ id_norma: options.idNorma, is_latest: true })
    .sort({ n_chars: -1 })
    .limit(10)
    .toArray();

  const articleExample = await unidadesCollection.findOne(
    {
      id_norma: options.idNorma,
      is_latest: true,
      unidad_tipo: "ARTICULO",
    },
    { sort: { n_chars: -1 } },
  );

  const dispositionExample = await unidadesCollection.findOne(
    {
      id_norma: options.idNorma,
      is_latest: true,
      unidad_tipo: { $in: ["DISPOSICION_ADICIONAL", "DISPOSICION_TRANSITORIA", "DISPOSICION_FINAL"] },
    },
    { sort: { n_chars: -1 } },
  );

  const randomChunks = await chunksCollection
    .aggregate<ChunkSemanticoDoc>([
      { $match: { id_norma: options.idNorma } },
      { $sample: { size: 5 } },
    ])
    .toArray();

  services.logger.info(
    {
      id_norma: options.idNorma,
      totalUnits,
      latestUnits,
      latestUnitsShorterThan200: shortest,
      shortRatioLatest: latestUnits > 0 ? Number(((shortest / latestUnits) * 100).toFixed(2)) : 0,
      top10Longest: topLongest.map(formatUnit),
      exampleArticulo: articleExample ? formatUnit(articleExample) : null,
      exampleDisposicion: dispositionExample ? formatUnit(dispositionExample) : null,
      randomChunks: randomChunks.map(formatChunk),
    },
    "rag-check",
  );
}

export function registerRagCheckCommand(
  program: Command,
  getServices: () => Promise<AppServices>,
): void {
  program
    .command("rag-check")
    .description("Diagnostico RAG por norma")
    .requiredOption("--id_norma <id>", "ID de norma (ej. BOE-A-2023-7500)")
    .action(async (cmdOptions: RagCheckOptions) => {
      const services = await getServices();
      await runRagCheck(services, cmdOptions);
    });
}

