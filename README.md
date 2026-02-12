# elocal-ia-boe-v2 (pnpm workspace)

Monorepo para ingesta BOE, construccion semantica, indexado vectorial y API RAG.

## Estructura

```text
packages/
  core/       # logica reusable (config, db, parsers, embeddings, qdrant)
  ingestor/   # discover + sync BOE -> Mongo
  builder/    # build-unidades + build-chunks -> Mongo
  indexer/    # embeddings + upsert chunks_semanticos -> Qdrant
  pipeline/   # BullMQ (seed/resume/workers/board)
  rag-api/    # Fastify API (RAG + pipeline stats)
  web-ui/     # Vite + React
```

## Requisitos

- Node.js 24+
- Corepack habilitado (`corepack enable`)
- Docker + Docker Compose

## Instalacion local

```bash
corepack enable
pnpm install
```

## Scripts raiz

```bash
pnpm build
pnpm test
pnpm dev:api
pnpm dev:web
pnpm dev:ingestor
pnpm dev:builder
pnpm dev:indexer

pnpm pipeline:backfill --help
pnpm pipeline:resume --help
pnpm pipeline:stats
pnpm pipeline:stop
```

## Variables de entorno

Copiar `.env.example` a `.env` y ajustar:

- Mongo: `MONGO_URL`, `MONGO_URI`, `MONGO_DB`
- Redis/BullMQ: `REDIS_URL`
- Qdrant: `QDRANT_URL`, `QDRANT_COLLECTION`, `QDRANT_API_KEY`
- Embeddings: `EMBEDDINGS_PROVIDER`, `EMBEDDINGS_MODEL`, `LOCAL_EMBEDDINGS_URL`, `OPENAI_API_KEY`
- Indexer: `INDEXER_BATCH_SIZE`, `INDEXER_EMBED_CONCURRENCY`, `INDEXER_CLEANUP_SCROLL_BATCH_SIZE`, `INDEXER_CLEANUP_DELETE_BATCH_SIZE`
- API: `PORT`, `CORS_ORIGINS`, `RAG_LLM_BASE_URL`, `RAG_LLM_MODEL`
- Pipeline: `PIPELINE_CONCURRENCY_*`, `PIPELINE_SEED_BATCH_SIZE`

## Docker Compose

### Stack API

```bash
docker compose up -d mongodb redis qdrant ollama rag-api web-ui
```

Health checks:

```bash
curl http://localhost:3000/health
curl http://localhost:3000/pipeline/stats
curl http://localhost:5173
```

### Pipeline paralelo (BullMQ)

1. Levantar Redis + workers + UI de colas:

```bash
docker compose --profile pipeline up -d mongodb redis qdrant ollama worker-orchestrator worker-sync worker-build worker-index bull-board
```

2. Encolar backfill total:

```bash
# desde host
pnpm pipeline:backfill

# o con compose (seeder one-shot)
docker compose --profile pipeline run --rm scheduler-seeder
```

Opciones utiles para pruebas:

```bash
pnpm pipeline:backfill --from 2024-01-01 --to 2024-12-31 --limit 200 --batch-size 100
pnpm pipeline:backfill --inline --wait
```

3. Reanudar pendientes/fallidos:

```bash
pnpm pipeline:resume
# o
pnpm pipeline:resume --inline --wait
```

4. Pausar colas:

```bash
pnpm pipeline:stop
```

5. Monitorizacion:

- Bull Board: `http://localhost:3100/admin/queues`
- API stats: `GET http://localhost:3000/pipeline/stats`
- CLI stats: `pnpm pipeline:stats`

## Contrato API

- `POST /rag/search`
- `POST /rag/answer`
- `GET /rag/unidad/:id_unidad`
- `GET /pipeline/stats`

## Notas de backfill total

- El backfill completo de legislacion consolidada puede tardar dias.
- Redis orquesta; la memoria real de progreso esta en Mongo `sync_state`.
- `pipeline:resume` usa checkpoints por etapa (`sync`, `build_units`, `build_chunks`, `index`).
- El pipeline es idempotente: repetir `resume` no debe duplicar resultados.

## Legacy pipeline

Si necesitas el flujo secuencial antiguo:

```bash
docker compose --profile pipeline-legacy run --rm ingestor
docker compose --profile pipeline-legacy run --rm builder
docker compose --profile pipeline-legacy run --rm indexer
```
