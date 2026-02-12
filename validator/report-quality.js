// report-quality.js
// Genera un reporte de chunks cortos y su distribución por norma/unidad/bloque.

const { MongoClient } = require("mongodb");

const MONGO_URI = process.env.MONGO_URI || "mongodb://admin:fIwQJw8mZGUHOGji@192.168.2.51:27017";
const DB_NAME = process.env.MONGO_DB || "boe_rag";
const TOP = parseInt(process.env.TOP || "20", 10);

async function main() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db(DB_NAME);

  const chunks = db.collection("chunks");
  const chunksSem = db.collection("chunks_semanticos");

  console.log("\n== CHUNKS (técnicos) cortos (<80) por norma ==");
  {
    const res = await chunks.aggregate([
      { $addFields: { len: { $strLenCP: "$texto" } } },
      { $match: { len: { $lt: 80 } } },
      { $group: { _id: "$id_norma", n: { $sum: 1 }, minLen: { $min: "$len" }, maxLen: { $max: "$len" } } },
      { $sort: { n: -1 } },
      { $limit: TOP }
    ]).toArray();
    console.table(res.map(x => ({ id_norma: x._id, n: x.n, minLen: x.minLen, maxLen: x.maxLen })));
  }

  console.log("\n== CHUNKS (técnicos) cortos (<80) por bloque ==");
  {
    const res = await chunks.aggregate([
      { $addFields: { len: { $strLenCP: "$texto" } } },
      { $match: { len: { $lt: 80 } } },
      { $group: { _id: { id_norma: "$id_norma", id_bloque: "$id_bloque" }, n: { $sum: 1 } } },
      { $sort: { n: -1 } },
      { $limit: TOP }
    ]).toArray();
    console.table(res.map(x => ({ id_norma: x._id.id_norma, id_bloque: x._id.id_bloque, n: x.n })));
  }

  console.log("\n== CHUNKS SEMÁNTICOS cortos (<80) por tipo de unidad ==");
  {
    const res = await chunksSem.aggregate([
      { $addFields: { len: { $strLenCP: "$texto" } } },
      { $match: { len: { $lt: 80 } } },
      { $group: { _id: "$metadata.unidad_tipo", n: { $sum: 1 }, minLen: { $min: "$len" }, maxLen: { $max: "$len" } } },
      { $sort: { n: -1 } },
      { $limit: TOP }
    ]).toArray();
    console.table(res.map(x => ({ unidad_tipo: x._id, n: x.n, minLen: x.minLen, maxLen: x.maxLen })));
  }

  console.log("\n== Muestras de chunks_semanticos cortos (con contexto) ==");
  {
    const sample = await chunksSem.aggregate([
      { $addFields: { len: { $strLenCP: "$texto" } } },
      { $match: { len: { $lt: 80 } } },
      { $project: {
        _id: 1, len: 1, id_norma: 1, id_unidad: 1,
        unidad_tipo: "$metadata.unidad_tipo",
        unidad_ref: "$metadata.unidad_ref",
        titulo: "$metadata.titulo",
        texto: 1
      }},
      { $limit: 10 }
    ]).toArray();
    for (const x of sample) {
      console.log("\n---");
      console.log(`id_norma=${x.id_norma} unidad=${x.unidad_tipo} ${x.unidad_ref} len=${x.len}`);
      console.log(`titulo=${x.titulo || ""}`);
      console.log(x.texto);
    }
  }

  await client.close();
}

main().catch(e => {
  console.error(e);
  process.exit(2);
});
