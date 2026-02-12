import { describe, expect, it } from "vitest";
import { buildIndiceTree } from "../../src/semantic/indexTree";

describe("semantic index tree", () => {
  it("builds hierarchy from ordered index blocks", () => {
    const tree = buildIndiceTree([
      {
        id_bloque: "ti",
        tipo: "encabezado",
        titulo_bloque: "TÍTULO I",
        fecha_actualizacion_bloque: null,
        fecha_actualizacion_bloque_raw: null,
        url_bloque: null,
      },
      {
        id_bloque: "ci",
        tipo: "encabezado",
        titulo_bloque: "CAPÍTULO I",
        fecha_actualizacion_bloque: null,
        fecha_actualizacion_bloque_raw: null,
        url_bloque: null,
      },
      {
        id_bloque: "a1",
        tipo: "precepto",
        titulo_bloque: "Artículo 1",
        fecha_actualizacion_bloque: null,
        fecha_actualizacion_bloque_raw: null,
        url_bloque: null,
      },
      {
        id_bloque: "a2",
        tipo: "precepto",
        titulo_bloque: "Artículo 2",
        fecha_actualizacion_bloque: null,
        fecha_actualizacion_bloque_raw: null,
        url_bloque: null,
      },
    ]);

    const title = tree.byId.get("ti");
    const chapter = tree.byId.get("ci");
    const article = tree.byId.get("a1");

    expect(title?.kind).toBe("HEADER");
    expect(title?.level).toBe(1);

    expect(chapter?.parent_id).toBe("ti");
    expect(chapter?.kind).toBe("HEADER");
    expect(chapter?.level).toBe(2);

    expect(article?.parent_id).toBe("ci");
    expect(article?.kind).toBe("UNIT_ROOT");
    expect(article?.unidad_tipo).toBe("ARTICULO");
  });
});
