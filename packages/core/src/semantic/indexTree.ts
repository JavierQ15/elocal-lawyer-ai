import type { BloqueIndiceNormalized } from "../types";
import { classifyIndiceBlock, type SemanticNodeKind } from "./classification";
import type { UnidadTipo } from "./contracts";

export interface IndiceTreeNode {
  id_bloque: string;
  tipo: string | null;
  titulo_bloque: string | null;
  fecha_actualizacion_bloque: Date | null;
  fecha_actualizacion_bloque_raw: string | null;
  url_bloque: string | null;
  order: number;
  level: number;
  unidad_tipo: UnidadTipo;
  kind: SemanticNodeKind;
  parent_id: string | null;
  children_ids: string[];
}

export interface IndiceTree {
  ordered: IndiceTreeNode[];
  byId: Map<string, IndiceTreeNode>;
  roots: IndiceTreeNode[];
}

export function buildIndiceTree(bloques: BloqueIndiceNormalized[]): IndiceTree {
  const ordered: IndiceTreeNode[] = [];
  const byId = new Map<string, IndiceTreeNode>();
  const roots: IndiceTreeNode[] = [];
  const stack: IndiceTreeNode[] = [];

  bloques.forEach((bloque, order) => {
    const classification = classifyIndiceBlock(bloque);

    while (stack.length > 0 && stack[stack.length - 1].level >= classification.level) {
      stack.pop();
    }

    const parent = stack.length > 0 ? stack[stack.length - 1] : null;

    const node: IndiceTreeNode = {
      id_bloque: bloque.id_bloque,
      tipo: bloque.tipo,
      titulo_bloque: bloque.titulo_bloque,
      fecha_actualizacion_bloque: bloque.fecha_actualizacion_bloque,
      fecha_actualizacion_bloque_raw: bloque.fecha_actualizacion_bloque_raw,
      url_bloque: bloque.url_bloque,
      order,
      level: classification.level,
      unidad_tipo: classification.unidad_tipo,
      kind: classification.kind,
      parent_id: parent?.id_bloque ?? null,
      children_ids: [],
    };

    ordered.push(node);
    byId.set(node.id_bloque, node);

    if (parent) {
      parent.children_ids.push(node.id_bloque);
    } else {
      roots.push(node);
    }

    stack.push(node);
  });

  return {
    ordered,
    byId,
    roots,
  };
}

export function collectSubtreeNodes(tree: IndiceTree, rootId: string): IndiceTreeNode[] {
  const start = tree.byId.get(rootId);
  if (!start) {
    return [];
  }

  const acc: IndiceTreeNode[] = [];
  const stack = [start];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    acc.push(current);

    for (let index = current.children_ids.length - 1; index >= 0; index -= 1) {
      const childId = current.children_ids[index];
      const child = tree.byId.get(childId);
      if (child) {
        stack.push(child);
      }
    }
  }

  return acc.sort((a, b) => a.order - b.order);
}
