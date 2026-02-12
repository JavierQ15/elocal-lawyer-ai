/* validate-db.js
   ValidaciÃ³n estructural + integridad + calidad para el RAG BOE.
   Requisitos: npm i mongodb
*/

const { MongoClient } = require("mongodb");

const MONGO_URI = process.env.MONGO_URI || "mongodb://admin:fIwQJw8mZGUHOGji@192.168.2.51:27017";
const DB_NAME = process.env.MONGO_DB || "boe_rag";

const LIMIT_SAMPLE = parseInt(process.env.LIMIT_SAMPLE || "500", 10); // muestras por colecciÃ³n (no hace full scan)
const FULL_SCAN = (process.env.FULL_SCAN || "1") === "1";            // 1 = recorre todo (puede tardar)
const FAIL_FAST = (process.env.FAIL_FAST || "0") === "1";            // 1 = aborta al primer error "hard"

/** util */
function isString(x) { return typeof x === "string" && x.length > 0; }
function isBool(x) { return typeof x === "boolean"; }
function isNumber(x) { return typeof x === "number" && Number.isFinite(x); }
function isObject(x) { return x && typeof x === "object" && !Array.isArray(x); }
function isISODate(x) { return x instanceof Date && !Number.isNaN(x.getTime()); }
function asDate(x) { return x instanceof Date ? x : null; }

function err(ctx, msg, extra) {
  const e = { level: "ERROR", ctx, msg, ...(extra ? { extra } : {}) };
  return e;
}
function warn(ctx, msg, extra) {
  const w = { level: "WARN", ctx, msg, ...(extra ? { extra } : {}) };
  return w;
}

function printReport(report) {
  const hard = report.find(r => r.level === "ERROR");
  const errors = report.filter(r => r.level === "ERROR").length;
  const warns = report.filter(r => r.level === "WARN").length;

  console.log("\n===== VALIDATION REPORT =====");
  console.log(`Errors: ${errors} | Warnings: ${warns}`);
  console.log("------------------------------");

  // Muestra primero errores, luego warnings
  for (const item of report) {
    const head = `[${item.level}] ${item.ctx}: ${item.msg}`;
    console.log(head);
    if (item.extra) console.log("   extra:", JSON.stringify(item.extra, null, 2));
  }

  console.log("------------------------------");
  console.log(hard ? "RESULT: FAIL" : "RESULT: OK (con posibles warnings)");
  console.log("==============================\n");

  return { ok: !hard, errors, warns };
}

/** Fetch helper: iterador con control de muestra / full */
async function sampleCursor(cursor, limit) {
  const out = [];
  while (await cursor.hasNext()) {
    out.push(await cursor.next());
    if (!FULL_SCAN && out.length >= limit) break;
  }
  return out;
}

async function main() {
  const client = new MongoClient(MONGO_URI, { ignoreUndefined: true });
  await client.connect();
  const db = client.db(DB_NAME);

  const report = [];

  // Colecciones
  const col = {
    normas: db.collection("normas"),
    indices: db.collection("indices"),
    bloques: db.collection("bloques"),
    versiones: db.collection("versiones"),
    chunks: db.collection("chunks"),
    unidades: db.collection("unidades"),
    chunks_semanticos: db.collection("chunks_semanticos"),
    territorios: db.collection("territorios"),
    sync_state: db.collection("sync_state"),
  };

  // ===== 0) Sanidad mÃ­nima: colecciones existen
  const names = await db.listCollections().toArray();
  const set = new Set(names.map(x => x.name));
  for (const k of Object.keys(col)) {
    if (!set.has(k)) report.push(err("bootstrap", `Falta la colecciÃ³n '${k}'`));
  }
  if (report.some(r => r.level === "ERROR") && FAIL_FAST) {
    printReport(report);
    process.exit(2);
  }

  // ===== 1) Checks de esquema por colecciÃ³n (muestras)
  // 1.1 normas
  {
    const docs = await sampleCursor(col.normas.find({}, { projection: { raw_item_json: 0 } }), LIMIT_SAMPLE);
    for (const d of docs) {
      const ctx = `normas:${d._id}`;
      if (!isString(d._id) || d._id !== d.id_norma) report.push(err(ctx, "`_id` debe ser string e igual a `id_norma`", { _id: d._id, id_norma: d.id_norma }));
      if (!isString(d.titulo)) report.push(err(ctx, "Falta/invalid `titulo`"));
      if (!isString(d.rango_texto)) report.push(warn(ctx, "Falta `rango_texto` (no crÃ­tico)"));
      if (!isString(d.ambito_texto)) report.push(warn(ctx, "Falta `ambito_texto` (no crÃ­tico)"));
      if (!isObject(d.territorio)) report.push(err(ctx, "Falta `territorio` (objeto)"));
      else {
        if (!isString(d.territorio.tipo)) report.push(err(ctx, "territorio.tipo invÃ¡lido"));
        if (!isString(d.territorio.codigo)) report.push(err(ctx, "territorio.codigo invÃ¡lido"));
      }
      if (d.fecha_publicacion && !isISODate(asDate(d.fecha_publicacion))) report.push(err(ctx, "fecha_publicacion no es Date"));
      if (d.fecha_disposicion && !isISODate(asDate(d.fecha_disposicion))) report.push(err(ctx, "fecha_disposicion no es Date"));
    }
  }

  // 1.2 territorios
  {
    const docs = await sampleCursor(col.territorios.find({}), LIMIT_SAMPLE);
    for (const d of docs) {
      const ctx = `territorios:${d._id}`;
      if (!isString(d._id) || d._id !== d.codigo) report.push(err(ctx, "`_id` debe ser igual a `codigo`", { _id: d._id, codigo: d.codigo }));
      if (!isString(d.nombre)) report.push(err(ctx, "Falta/invalid `nombre`"));
      if (!["ESTATAL", "AUTONOMICO"].includes(d.tipo)) report.push(err(ctx, "`tipo` debe ser ESTATAL|AUTONOMICO", { tipo: d.tipo }));
    }
  }

  // 1.3 indices
  {
    const docs = await sampleCursor(col.indices.find({}), LIMIT_SAMPLE);
    for (const d of docs) {
      const ctx = `indices:${d._id}`;
      if (d._id !== d.id_indice) report.push(err(ctx, "`_id` debe ser igual a `id_indice`"));
      if (!isString(d.id_norma)) report.push(err(ctx, "Falta `id_norma`"));
      if (!isBool(d.is_latest)) report.push(err(ctx, "Falta/invalid `is_latest`"));
      if (d.fecha_actualizacion_indice && !isISODate(asDate(d.fecha_actualizacion_indice))) report.push(err(ctx, "fecha_actualizacion_indice no es Date"));
      if (!isString(d.hash_xml)) report.push(warn(ctx, "Falta `hash_xml` (no crÃ­tico si guardas xml fuera)"));
    }
  }

  // 1.4 bloques
  {
    const docs = await sampleCursor(col.bloques.find({}), LIMIT_SAMPLE);
    for (const d of docs) {
      const ctx = `bloques:${d._id}`;
      if (!isString(d.id_norma)) report.push(err(ctx, "Falta `id_norma`"));
      if (!isString(d.id_bloque)) report.push(err(ctx, "Falta `id_bloque`"));
      // _id esperado: "IDNORMA:IDBLOQUE"
      const expected = `${d.id_norma}:${d.id_bloque}`;
      if (d._id !== expected) report.push(warn(ctx, "`_id` no sigue patrÃ³n id_norma:id_bloque", { _id: d._id, expected }));
      if (!isString(d.tipo)) report.push(warn(ctx, "Falta `tipo`"));
      if (!isString(d.latest_version_id)) report.push(warn(ctx, "Falta `latest_version_id`"));
      if (d.fecha_actualizacion_bloque && !isISODate(asDate(d.fecha_actualizacion_bloque))) report.push(err(ctx, "fecha_actualizacion_bloque no es Date"));
    }
  }

  // 1.5 versiones
  {
    const docs = await sampleCursor(col.versiones.find({}), LIMIT_SAMPLE);
    for (const d of docs) {
      const ctx = `versiones:${d._id}`;
      if (d._id !== d.id_version) report.push(err(ctx, "`_id` debe ser igual a `id_version`"));
      if (!isString(d.id_norma)) report.push(err(ctx, "Falta `id_norma`"));
      if (!isString(d.id_bloque)) report.push(err(ctx, "Falta `id_bloque`"));
      if (!isISODate(asDate(d.fecha_vigencia_desde))) report.push(err(ctx, "Falta/invalid `fecha_vigencia_desde` (Date)"));
      if (!isISODate(asDate(d.fecha_publicacion_mod))) report.push(err(ctx, "Falta/invalid `fecha_publicacion_mod` (Date)"));
      if (!isBool(d.is_latest)) report.push(err(ctx, "Falta/invalid `is_latest`"));
      if (!isString(d.texto_hash)) report.push(warn(ctx, "Falta `texto_hash` (no crÃ­tico, pero recomendable)"));
      if (d.texto_plano != null && typeof d.texto_plano !== "string") report.push(err(ctx, "`texto_plano` debe ser string o null"));
      if (isString(d.texto_plano) && isNumber(d.n_chars) && d.n_chars !== d.texto_plano.length) {
        report.push(warn(ctx, "`n_chars` no coincide con longitud de texto_plano", { n_chars: d.n_chars, actual: d.texto_plano.length }));
      }
      // coherencia temporal bÃ¡sica
      if (asDate(d.fecha_publicacion_mod) && asDate(d.fecha_vigencia_desde) && d.fecha_vigencia_desde < d.fecha_publicacion_mod) {
        // Ojo: puede ocurrir si vigencia inmediata o retroactiva; lo marco warning
        report.push(warn(ctx, "fecha_vigencia_desde < fecha_publicacion_mod (posible retroactividad, revisar)", {
          fecha_vigencia_desde: d.fecha_vigencia_desde,
          fecha_publicacion_mod: d.fecha_publicacion_mod,
        }));
      }
    }
  }

  // 1.6 chunks (tÃ©cnicos)
  {
    const docs = await sampleCursor(col.chunks.find({}), LIMIT_SAMPLE);
    for (const d of docs) {
      const ctx = `chunks:${d._id}`;
      if (!isString(d.id_norma)) report.push(err(ctx, "Falta `id_norma`"));
      if (!isString(d.id_version)) report.push(err(ctx, "Falta `id_version`"));
      if (!isString(d.id_bloque)) report.push(err(ctx, "Falta `id_bloque`"));
      if (!isNumber(d.chunk_index)) report.push(err(ctx, "Falta/invalid `chunk_index`"));
      if (!isString(d.texto)) report.push(err(ctx, "Falta/invalid `texto`"));
      if (isString(d.texto) && d.texto.length < 80) report.push(warn(ctx, "Chunk muy corto (<80 chars)", { len: d.texto.length }));
      if (!isObject(d.metadata)) report.push(warn(ctx, "Falta `metadata`"));
    }
  }

  // 1.7 unidades (semÃ¡nticas)
  {
    const docs = await sampleCursor(col.unidades.find({}), LIMIT_SAMPLE);
    for (const d of docs) {
      const ctx = `unidades:${d._id}`;
      if (d._id !== d.id_unidad) report.push(err(ctx, "`_id` debe ser igual a `id_unidad`"));
      if (!isString(d.id_norma)) report.push(err(ctx, "Falta `id_norma`"));
      if (!isString(d.unidad_tipo)) report.push(err(ctx, "Falta `unidad_tipo`"));
      if (!isString(d.unidad_ref)) report.push(warn(ctx, "Falta `unidad_ref`"));
      if (!isString(d.texto_plano)) report.push(err(ctx, "Falta `texto_plano`"));
      if (isString(d.texto_plano) && d.texto_plano.length < 200) report.push(warn(ctx, "Unidad muy corta (<200 chars)", { len: d.texto_plano.length }));
      if (!isISODate(asDate(d.fecha_vigencia_desde))) report.push(err(ctx, "Falta/invalid `fecha_vigencia_desde`"));
      if (!("fecha_vigencia_hasta" in d)) report.push(err(ctx, "Falta `fecha_vigencia_hasta` (null permitido)"));
      else if (d.fecha_vigencia_hasta !== null && !isISODate(asDate(d.fecha_vigencia_hasta))) {
        report.push(err(ctx, "`fecha_vigencia_hasta` debe ser Date o null"));
      }
      if (!isBool(d.is_latest)) report.push(err(ctx, "Falta/invalid `is_latest`"));
      if (!isObject(d.metadata) || !isObject(d.metadata.territorio)) report.push(err(ctx, "Falta metadata.territorio"));
      if (isString(d.texto_plano) && isNumber(d.n_chars) && d.n_chars !== d.texto_plano.length) {
        report.push(warn(ctx, "`n_chars` no coincide con longitud de texto_plano", { n_chars: d.n_chars, actual: d.texto_plano.length }));
      }
    }
  }

  // 1.8 chunks_semanticos
  {
    const docs = await sampleCursor(col.chunks_semanticos.find({}), LIMIT_SAMPLE);
    for (const d of docs) {
      const ctx = `chunks_semanticos:${d._id}`;
      if (!isString(d.id_unidad)) report.push(err(ctx, "Falta `id_unidad`"));
      if (!isString(d.id_norma)) report.push(err(ctx, "Falta `id_norma`"));
      if (!isNumber(d.chunk_index)) report.push(err(ctx, "Falta/invalid `chunk_index`"));
      if (!isString(d.texto)) report.push(err(ctx, "Falta/invalid `texto`"));
      if (d.texto.length < 80) report.push(warn(ctx, "Chunk semÃ¡ntico muy corto (<80 chars)", { len: d.texto.length }));
      if (!isObject(d.metadata) || !isObject(d.metadata.territorio)) report.push(err(ctx, "Falta metadata.territorio"));
      if (!isObject(d.metadata) || !("fecha_vigencia_desde" in d.metadata)) {
        report.push(err(ctx, "Falta metadata.fecha_vigencia_desde"));
      }
      if (!isObject(d.metadata) || !("fecha_vigencia_hasta" in d.metadata)) {
        report.push(err(ctx, "Falta metadata.fecha_vigencia_hasta (null permitido)"));
      } else if (d.metadata.fecha_vigencia_hasta !== null && !isISODate(asDate(d.metadata.fecha_vigencia_hasta))) {
        report.push(err(ctx, "metadata.fecha_vigencia_hasta debe ser Date o null"));
      }
    }
  }

  // 1.9 sync_state
  {
    const docs = await sampleCursor(col.sync_state.find({}), LIMIT_SAMPLE);
    for (const d of docs) {
      const ctx = `sync_state:${d._id}`;
      if (d._id !== d.id_norma) report.push(warn(ctx, "`_id` no coincide con `id_norma`", { _id: d._id, id_norma: d.id_norma }));
      if (!isString(d.status)) report.push(err(ctx, "Falta `status`"));
      if (d.last_started_at && !isISODate(asDate(d.last_started_at))) report.push(err(ctx, "last_started_at no es Date"));
      if (d.last_finished_at && !isISODate(asDate(d.last_finished_at))) report.push(err(ctx, "last_finished_at no es Date"));
    }
  }

  if (report.some(r => r.level === "ERROR") && FAIL_FAST) {
    printReport(report);
    process.exit(2);
  }

  // ===== 2) Integridad referencial (con queries agregadas eficientes)

  // 2.1 indices -> normas
  {
    const missing = await col.indices.aggregate([
      { $lookup: { from: "normas", localField: "id_norma", foreignField: "_id", as: "n" } },
      { $match: { n: { $size: 0 } } },
      { $limit: 50 },
      { $project: { _id: 1, id_norma: 1 } },
    ]).toArray();

    if (missing.length) {
      report.push(err("ref:indices->normas", "Hay Ã­ndices con id_norma inexistente en normas", { sample: missing }));
    }
  }

  // 2.2 bloques -> normas
  {
    const missing = await col.bloques.aggregate([
      { $lookup: { from: "normas", localField: "id_norma", foreignField: "_id", as: "n" } },
      { $match: { n: { $size: 0 } } },
      { $limit: 50 },
      { $project: { _id: 1, id_norma: 1, id_bloque: 1 } },
    ]).toArray();

    if (missing.length) {
      report.push(err("ref:bloques->normas", "Hay bloques con id_norma inexistente en normas", { sample: missing }));
    }
  }

  // 2.3 versiones -> normas y -> bloques
  {
    const missingNormas = await col.versiones.aggregate([
      { $lookup: { from: "normas", localField: "id_norma", foreignField: "_id", as: "n" } },
      { $match: { n: { $size: 0 } } },
      { $limit: 50 },
      { $project: { _id: 1, id_norma: 1, id_bloque: 1 } },
    ]).toArray();

    if (missingNormas.length) {
      report.push(err("ref:versiones->normas", "Hay versiones con id_norma inexistente en normas", { sample: missingNormas }));
    }

    const missingBloques = await col.versiones.aggregate([
      {
        $lookup: {
          from: "bloques",
          let: { id_norma: "$id_norma", id_bloque: "$id_bloque" },
          pipeline: [
            { $match: { $expr: { $and: [
              { $eq: ["$id_norma", "$$id_norma"] },
              { $eq: ["$id_bloque", "$$id_bloque"] },
            ]}}},
            { $project: { _id: 1 } },
          ],
          as: "b"
        }
      },
      { $match: { b: { $size: 0 } } },
      { $limit: 50 },
      { $project: { _id: 1, id_norma: 1, id_bloque: 1 } },
    ]).toArray();

    if (missingBloques.length) {
      report.push(err("ref:versiones->bloques", "Hay versiones cuyo (id_norma,id_bloque) no existe en bloques", { sample: missingBloques }));
    }
  }

  // 2.4 chunks -> versiones
  {
    const missing = await col.chunks.aggregate([
      { $lookup: { from: "versiones", localField: "id_version", foreignField: "_id", as: "v" } },
      { $match: { v: { $size: 0 } } },
      { $limit: 50 },
      { $project: { _id: 1, id_version: 1, id_norma: 1, id_bloque: 1 } },
    ]).toArray();

    if (missing.length) {
      report.push(err("ref:chunks->versiones", "Hay chunks con id_version inexistente en versiones", { sample: missing }));
    }
  }

  // 2.5 unidades -> normas
  {
    const missing = await col.unidades.aggregate([
      { $lookup: { from: "normas", localField: "id_norma", foreignField: "_id", as: "n" } },
      { $match: { n: { $size: 0 } } },
      { $limit: 50 },
      { $project: { _id: 1, id_norma: 1, unidad_tipo: 1, unidad_ref: 1 } },
    ]).toArray();

    if (missing.length) {
      report.push(err("ref:unidades->normas", "Hay unidades con id_norma inexistente en normas", { sample: missing }));
    }
  }

  // 2.6 chunks_semanticos -> unidades
  {
    const missing = await col.chunks_semanticos.aggregate([
      { $lookup: { from: "unidades", localField: "id_unidad", foreignField: "_id", as: "u" } },
      { $match: { u: { $size: 0 } } },
      { $limit: 50 },
      { $project: { _id: 1, id_unidad: 1, id_norma: 1 } },
    ]).toArray();

    if (missing.length) {
      report.push(err("ref:chunks_semanticos->unidades", "Hay chunks_semanticos con id_unidad inexistente en unidades", { sample: missing }));
    }
  }

  // 2.7 coherencia territorial: normas.territorio.codigo debe existir en territorios
  {
    const missing = await col.normas.aggregate([
      { $lookup: { from: "territorios", localField: "territorio.codigo", foreignField: "_id", as: "t" } },
      { $match: { t: { $size: 0 } } },
      { $limit: 50 },
      { $project: { _id: 1, "territorio.codigo": 1, "territorio.tipo": 1 } },
    ]).toArray();

    if (missing.length) {
      report.push(err("ref:normas.territorio->territorios", "Hay normas cuyo territorio.codigo no existe en territorios", { sample: missing }));
    }
  }

  // 2.8 coherencia territorial replicada: unidades.metadata.territorio.codigo existe en territorios
  {
    const missing = await col.unidades.aggregate([
      { $lookup: { from: "territorios", localField: "metadata.territorio.codigo", foreignField: "_id", as: "t" } },
      { $match: { t: { $size: 0 } } },
      { $limit: 50 },
      { $project: { _id: 1, id_norma: 1, "metadata.territorio.codigo": 1 } },
    ]).toArray();

    if (missing.length) {
      report.push(err("ref:unidades.metadata.territorio->territorios", "Hay unidades cuyo metadata.territorio.codigo no existe en territorios", { sample: missing }));
    }
  }

  // 2.9 coherencia territorial replicada: chunks_semanticos.metadata.territorio.codigo existe en territorios
  {
    const missing = await col.chunks_semanticos.aggregate([
      { $lookup: { from: "territorios", localField: "metadata.territorio.codigo", foreignField: "_id", as: "t" } },
      { $match: { t: { $size: 0 } } },
      { $limit: 50 },
      { $project: { _id: 1, id_norma: 1, "metadata.territorio.codigo": 1 } },
    ]).toArray();

    if (missing.length) {
      report.push(err("ref:chunks_semanticos.metadata.territorio->territorios", "Hay chunks_semanticos cuyo metadata.territorio.codigo no existe en territorios", { sample: missing }));
    }
  }

  // ===== 3) Reglas de unicidad / latest

  // 3.1 indices: un solo is_latest=true por norma
  {
    const dup = await col.indices.aggregate([
      { $match: { is_latest: true } },
      { $group: { _id: "$id_norma", n: { $sum: 1 }, ids: { $push: "$_id" } } },
      { $match: { n: { $gt: 1 } } },
      { $limit: 50 },
    ]).toArray();

    if (dup.length) report.push(err("latest:indices", "Hay mÃ¡s de un Ã­ndice latest por id_norma", { sample: dup }));
  }

  // 3.2 versiones: un solo is_latest=true por (id_norma,id_bloque)
  {
    const dup = await col.versiones.aggregate([
      { $match: { is_latest: true } },
      { $group: {
        _id: { id_norma: "$id_norma", id_bloque: "$id_bloque" },
        n: { $sum: 1 },
        ids: { $push: "$_id" }
      }},
      { $match: { n: { $gt: 1 } } },
      { $limit: 50 },
    ]).toArray();

    if (dup.length) report.push(err("latest:versiones", "Hay mÃ¡s de una versiÃ³n latest por (id_norma,id_bloque)", { sample: dup }));
  }

  // 3.3 unidades: un solo is_latest=true por (id_norma,unidad_tipo,unidad_ref) (o lineage_key si lo usas)
  {
    const pipeline = [
      { $match: { is_latest: true } },
      { $group: {
        _id: { id_norma: "$id_norma", unidad_tipo: "$unidad_tipo", unidad_ref: "$unidad_ref" },
        n: { $sum: 1 },
        ids: { $push: "$_id" }
      }},
      { $match: { n: { $gt: 1 } } },
      { $limit: 50 },
    ];
    const dup = await col.unidades.aggregate(pipeline).toArray();
    if (dup.length) report.push(err("latest:unidades", "Hay mÃ¡s de una unidad latest por (id_norma,unidad_tipo,unidad_ref)", { sample: dup }));
  }

  // 3.4 bloques.latest_version_id debe existir en versiones y ser is_latest=true para ese (id_norma,id_bloque)
  {
    const bad = await col.bloques.aggregate([
      {
        $lookup: {
          from: "versiones",
          localField: "latest_version_id",
          foreignField: "_id",
          as: "v"
        }
      },
      { $match: { v: { $size: 0 } } },
      { $limit: 50 },
      { $project: { _id: 1, id_norma: 1, id_bloque: 1, latest_version_id: 1 } },
    ]).toArray();

    if (bad.length) report.push(err("latest:bloques.latest_version_id", "Hay bloques cuyo latest_version_id no existe en versiones", { sample: bad }));

    const mismatch = await col.bloques.aggregate([
      { $lookup: { from: "versiones", localField: "latest_version_id", foreignField: "_id", as: "v" } },
      { $unwind: "$v" },
      { $match: { $expr: { $or: [
        { $ne: ["$id_norma", "$v.id_norma"] },
        { $ne: ["$id_bloque", "$v.id_bloque"] },
        { $ne: ["$v.is_latest", true] },
      ]}}},
      { $limit: 50 },
      { $project: { _id: 1, id_norma: 1, id_bloque: 1, latest_version_id: 1, v: { id_norma: 1, id_bloque: 1, is_latest: 1 } } }
    ]).toArray();

    if (mismatch.length) report.push(err("latest:bloques->versiones", "Hay bloques cuyo latest_version_id no coincide con (id_norma,id_bloque) o la versiÃ³n no es latest", { sample: mismatch }));
  }

  // ===== 4) Checks de calidad: longitudes y distribuciÃ³n
  // (estos no son â€œhard errorsâ€ salvo que quieras endurecerlos)

  // 4.1 porcentaje de unidades cortas
  {
    const total = await col.unidades.estimatedDocumentCount();
    const short = await col.unidades.countDocuments({ n_chars: { $lt: 200 } });
    if (total > 0) {
      const pct = (short / total) * 100;
      if (pct > 5) report.push(warn("quality:unidades", `Unidades <200 chars: ${short}/${total} (${pct.toFixed(2)}%) supera objetivo 5%`));
      else report.push(warn("quality:unidades", `Unidades <200 chars: ${short}/${total} (${pct.toFixed(2)}%)`));
    }
  }

  // 4.2 chunks_semanticos cortos
  {
    const total = await col.chunks_semanticos.estimatedDocumentCount();
    const short = await col.chunks_semanticos.countDocuments({ $expr: { $lt: [ { $strLenCP: "$texto" }, 80 ] } });
    if (total > 0) {
      const pct = (short / total) * 100;
      if (pct > 2) report.push(warn("quality:chunks_semanticos", `Chunks semÃ¡nticos <80 chars: ${short}/${total} (${pct.toFixed(2)}%)`));
    }
  }

  // ===== 5) Checks especÃ­ficos que â€œsaltanâ€ en tu muestra

  // 5.1 Versiones con id_bloque='no' y tipo 'nota_inicial' suelen ser â€œaviso de vigencia agotadaâ€.
  // No es invÃ¡lido, pero debes evitar que esto sea tu retrieval principal.
  // AquÃ­ lo marcamos como warning si norma estÃ¡ finalizada (estado_consolidacion Finalizado o vigencia_agotada = S) y texto corto.
  {
    const sample = await col.versiones.find(
      { id_bloque: "no", n_chars: { $lt: 350 } },
      { projection: { _id: 1, id_norma: 1, id_bloque: 1, n_chars: 1, texto_plano: 1 } }
    ).limit(20).toArray();

    if (sample.length) {
      report.push(warn("domain:nota_inicial", "Detectadas versiones tipo nota_inicial / bloque 'no' con texto corto: normal, pero deben excluirse del retrieval principal", {
        sample: sample.map(x => ({ id_version: x._id, id_norma: x.id_norma, n_chars: x.n_chars }))
      }));
    }
  }

  // ===== Emitir informe
  const res = printReport(report);

  await client.close();

  // cÃ³digo de salida
  process.exit(res.ok ? 0 : 2);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(3);
});

