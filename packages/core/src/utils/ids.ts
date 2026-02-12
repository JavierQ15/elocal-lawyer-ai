import { deterministicId } from "./hash";

export function buildIndiceId(params: {
  idNorma: string;
  fechaActualizacionIndiceRaw: string | null;
  hashXml: string;
}): string {
  return deterministicId([
    params.idNorma,
    params.fechaActualizacionIndiceRaw ?? "",
    params.hashXml,
  ]);
}

export function buildVersionId(params: {
  idNorma: string;
  idBloque: string;
  fechaVigenciaDesdeRaw: string | null;
  idNormaModificadora: string | null;
  hashXml: string;
}): string {
  return deterministicId([
    params.idNorma,
    params.idBloque,
    params.fechaVigenciaDesdeRaw ?? "",
    params.idNormaModificadora ?? "",
    params.hashXml,
  ]);
}

export function buildChunkId(params: {
  idVersion: string;
  chunkIndex: number;
  textoHash: string;
}): string {
  return deterministicId([
    params.idVersion,
    String(params.chunkIndex),
    params.textoHash,
  ]);
}

export function buildSemanticChunkId(params: {
  idUnidad: string;
  chunkingHash: string;
  chunkIndex: number;
  textoHash: string;
}): string {
  return deterministicId([
    params.idUnidad,
    params.chunkingHash,
    String(params.chunkIndex),
    params.textoHash,
  ]);
}
