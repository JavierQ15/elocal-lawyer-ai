import type { Db } from "mongodb";
import type { UnidadDoc } from "../semantic/contracts";

export interface RagUnidadRecord {
  id_unidad: string;
  id_norma: string;
  unidad_tipo: UnidadDoc["unidad_tipo"];
  unidad_ref: string;
  titulo: string | null;
  texto_plano: string;
  fecha_vigencia_desde: Date | null;
  fecha_vigencia_hasta: Date | null;
  territorio: {
    codigo: string;
    tipo: "ESTATAL" | "AUTONOMICO";
    nombre: string;
  };
  url_html_consolidada: string | null;
  url_eli: string | null;
}

function mapUnidadDocToRagRecord(doc: UnidadDoc): RagUnidadRecord {
  return {
    id_unidad: doc.id_unidad,
    id_norma: doc.id_norma,
    unidad_tipo: doc.unidad_tipo,
    unidad_ref: doc.unidad_ref,
    titulo: doc.titulo,
    texto_plano: doc.texto_plano,
    fecha_vigencia_desde: doc.fecha_vigencia_desde,
    fecha_vigencia_hasta: doc.fecha_vigencia_hasta,
    territorio: {
      codigo: doc.metadata.territorio.codigo,
      tipo: doc.metadata.territorio.tipo,
      nombre: doc.metadata.territorio.nombre,
    },
    url_html_consolidada: doc.metadata.url_html_consolidada,
    url_eli: doc.metadata.url_eli,
  };
}

function uniqueNonEmptyIds(ids: string[]): string[] {
  return Array.from(
    new Set(
      ids
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  );
}

export async function getUnidadesByIds(db: Db, ids: string[]): Promise<RagUnidadRecord[]> {
  const normalizedIds = uniqueNonEmptyIds(ids);
  if (normalizedIds.length === 0) {
    return [];
  }

  const unidades = await db
    .collection<UnidadDoc>("unidades")
    .find({ id_unidad: { $in: normalizedIds } })
    .toArray();

  const byId = new Map<string, RagUnidadRecord>();
  for (const unidad of unidades) {
    byId.set(unidad.id_unidad, mapUnidadDocToRagRecord(unidad));
  }

  return normalizedIds
    .map((id) => byId.get(id))
    .filter((item): item is RagUnidadRecord => item !== undefined);
}

export async function getUnidadById(db: Db, idUnidad: string): Promise<RagUnidadRecord | null> {
  const normalized = idUnidad.trim();
  if (normalized.length === 0) {
    return null;
  }

  const unidad = await db
    .collection<UnidadDoc>("unidades")
    .findOne({ id_unidad: normalized });

  if (!unidad) {
    return null;
  }

  return mapUnidadDocToRagRecord(unidad);
}
