import type { Document, Filter } from "mongodb";

export interface VigenciaIntervalInput {
  _id: string;
  fecha_vigencia_desde: Date | null;
}

export interface VigenciaIntervalResult {
  _id: string;
  fecha_vigencia_hasta: Date | null;
}

export interface VigenciaRange {
  fecha_vigencia_desde: Date | null;
  fecha_vigencia_hasta: Date | null;
}

export interface VigenciaFilterPaths {
  desdePath: string;
  hastaPath: string;
}

const DEFAULT_VIGENCIA_FILTER_PATHS: VigenciaFilterPaths = {
  desdePath: "metadata.fecha_vigencia_desde",
  hastaPath: "metadata.fecha_vigencia_hasta",
};

function getSortTimestamp(date: Date | null): number {
  return date ? date.getTime() : Number.NEGATIVE_INFINITY;
}

export function compareByVigenciaDesdeAndId(
  a: VigenciaIntervalInput,
  b: VigenciaIntervalInput,
): number {
  const aTime = getSortTimestamp(a.fecha_vigencia_desde);
  const bTime = getSortTimestamp(b.fecha_vigencia_desde);

  if (aTime !== bTime) {
    return aTime - bTime;
  }

  return a._id.localeCompare(b._id);
}

export function buildVigenciaHastaIntervals<T extends VigenciaIntervalInput>(
  items: T[],
): VigenciaIntervalResult[] {
  const sorted = [...items].sort(compareByVigenciaDesdeAndId);

  return sorted.map((item, index) => ({
    _id: item._id,
    fecha_vigencia_hasta: sorted[index + 1]?.fecha_vigencia_desde ?? null,
  }));
}

export function isDateWithinVigenciaRange(asOf: Date, range: VigenciaRange): boolean {
  if (!range.fecha_vigencia_desde) {
    return false;
  }

  if (range.fecha_vigencia_desde.getTime() > asOf.getTime()) {
    return false;
  }

  if (!range.fecha_vigencia_hasta) {
    return true;
  }

  return asOf.getTime() < range.fecha_vigencia_hasta.getTime();
}

export function buildVigenciaAsOfFilter<TSchema extends Document = Document>(
  asOf: Date,
  paths: VigenciaFilterPaths = DEFAULT_VIGENCIA_FILTER_PATHS,
): Filter<TSchema> {
  const filter = {
    [paths.desdePath]: { $lte: asOf },
    $or: [
      { [paths.hastaPath]: null },
      { [paths.hastaPath]: { $gt: asOf } },
    ],
  };

  return filter as Filter<TSchema>;
}

export function buildVigenciaTodayFilter<TSchema extends Document = Document>(
  now: Date = new Date(),
  paths: VigenciaFilterPaths = DEFAULT_VIGENCIA_FILTER_PATHS,
): Filter<TSchema> {
  return buildVigenciaAsOfFilter<TSchema>(now, paths);
}
