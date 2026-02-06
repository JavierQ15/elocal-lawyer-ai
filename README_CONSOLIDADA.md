# BOE Consolidated Legislation RAG System

Sistema RAG (Retrieval-Augmented Generation) para consultar **Legislación Consolidada** del BOE (Boletín Oficial del Estado de España). Este sistema permite consultar tanto legislación **vigente** (actual) como **histórica** (válida en una fecha específica del pasado).

## 🏗️ Arquitectura

El sistema utiliza las siguientes tecnologías:

- **PostgreSQL**: Base de datos principal (source of truth) para almacenar normas, bloques, versiones y fragmentos
- **Qdrant**: Dos colecciones vectoriales para búsqueda semántica:
  - `boe_historico_all`: Todas las versiones históricas
  - `boe_vigente_latest`: Solo versiones vigentes actuales
- **Apache Airflow**: Orquestación de pipelines de datos
  - `boe_sync_consolidada`: Sincronización incremental diaria
  - `rag_embed_and_index`: Generación de embeddings e indexación
- **Ollama**: Modelos LLM locales para embeddings y generación de respuestas
- **FastAPI**: API REST para consultas RAG con modos vigente/histórico
- **Docker Compose**: Orquestación de todos los servicios

## 🎯 Características Principales

- ✅ **Legislación Consolidada**: Usa la API oficial del BOE (no scraping HTML)
- ✅ **Histórico + Vigente**: Consulta legislación actual o válida en una fecha pasada
- ✅ **Versionado Completo**: Rastrea todas las modificaciones de cada bloque legal
- ✅ **IDs Deterministas**: Basados en SHA256 para idempotencia perfecta
- ✅ **Carga Masiva + Incremental**: Soporta carga inicial completa y actualizaciones diarias
- ✅ **Chunking Inteligente**: División por artículos cuando es posible
- ✅ **Citas Precisas**: Respuestas con referencias exactas (norma, bloque, artículo, fecha vigencia)
- ✅ **Reanudable**: Los procesos pueden recuperarse si fallan

## 📋 Requisitos Previos

- Docker Engine 20.10 o superior
- Docker Compose 2.0 o superior
- 16GB RAM mínimo (recomendado 32GB)
- 50GB espacio en disco
- (Opcional) GPU NVIDIA con drivers CUDA para mejor rendimiento

## ⚡ Quickstart

### 1. Clonar el repositorio

```bash
git clone https://github.com/JavierQ15/elocal-lawyer-ai.git
cd elocal-lawyer-ai
```

### 2. Configuración inicial

```bash
make init
```

Este comando realizará automáticamente:
- Copia `.env.example` a `.env` y genera claves secretas
- Construye todas las imágenes Docker
- Inicia todos los servicios
- Descarga los modelos de Ollama necesarios

**Nota**: El primer inicio puede tardar 10-15 minutos.

### 3. Verificar servicios

```bash
make status
```

### 4. Acceder a las interfaces

- **Airflow UI**: http://localhost:8080 (admin/admin)
- **RAG API (Swagger)**: http://localhost:8000/docs
- **Qdrant Dashboard**: http://localhost:6333/dashboard

### 5. Ejecutar Smoke Test

El smoke test inserta 1 norma de prueba con 2 bloques y verifica todo el flujo:

```bash
# Dentro del contenedor
docker compose exec rag-api python /app/../scripts/smoke_test.py

# O desde el host (si tienes Python 3)
python scripts/smoke_test.py
```

### 6. Ejecutar DAGs para datos reales

1. Accede a Airflow UI (http://localhost:8080)
2. Activa el DAG `boe_sync_consolidada`
3. Ejecuta manualmente con parámetros:
   ```json
   {
     "from_date": "2024-01-01",
     "to_date": "2024-01-31"
   }
   ```
4. El DAG `rag_embed_and_index` se ejecutará automáticamente cada hora

### 7. Consultar la API

#### Modo Vigente (legislación actual)

```bash
curl -X POST http://localhost:8000/query \
  -H "Content-Type: application/json" \
  -d '{
    "question": "¿Qué dice la legislación sobre protección de datos?",
    "mode": "vigente",
    "max_results": 5
  }'
```

#### Modo Histórico (legislación válida en una fecha)

```bash
curl -X POST http://localhost:8000/query \
  -H "Content-Type: application/json" \
  -d '{
    "question": "¿Qué regulaciones existían sobre RGPD?",
    "mode": "historico",
    "as_of_date": "2020-06-15",
    "max_results": 5
  }'
```

## 📊 Modelo de Datos

### Tablas Principales (Postgres = Source of Truth)

```sql
-- Normas (leyes, reales decretos, etc.)
boe_norma
  - id_norma (PK): e.g., BOE-A-2024-12345
  - titulo, rango, departamento, ambito
  - fecha_publicacion, fecha_disposicion
  - url_html_consolidada, url_eli
  - fecha_actualizacion_api (para incremental)
  - metadata_jsonb

-- Bloques (estructura de la norma: títulos, capítulos, artículos)
boe_bloque
  - (id_norma, id_bloque) PK
  - tipo, titulo_bloque
  - fecha_actualizacion_bloque (para detectar cambios)
  - url_bloque

-- Versiones (histórico de modificaciones de cada bloque)
boe_version
  - id_version (PK determinista = SHA256)
  - id_norma, id_bloque
  - id_norma_modificadora (qué norma modificó esta versión)
  - fecha_vigencia_desde, vigencia_hasta
  - hash_html, hash_texto (para idempotencia)

-- Fragmentos (chunks de texto de cada versión)
boe_fragmento
  - id_fragmento (PK determinista = SHA256)
  - id_version (FK)
  - ordinal, texto_normalizado
  - articulo_ref (referencia al artículo si aplica)
  - hash_texto

-- Cola de embeddings pendientes
pending_embeddings
  - id_fragmento (PK, FK)
  - status: pending, processing, completed, failed
  - attempts, last_error
```

### Colecciones Qdrant

1. **boe_historico_all**: Contiene TODAS las versiones (históricas + vigentes)
   - Filtrable por `vigencia_desde` y `vigencia_hasta`
   
2. **boe_vigente_latest**: Contiene SOLO versiones vigentes HOY
   - Se refresca automáticamente cada hora

**Payload en Qdrant** (NO incluye texto completo):
```json
{
  "id_fragmento": "sha256...",
  "id_norma": "BOE-A-2024-12345",
  "id_bloque": "ART_5",
  "id_version": "sha256...",
  "ordinal": 0,
  "articulo_ref": "Artículo 5",
  "vigencia_desde": "2024-01-01",
  "vigencia_hasta": "2025-06-30",
  "tipo_bloque": "Artículo",
  "titulo_bloque": "Artículo 5. Definiciones",
  "url_html_consolidada": "https://...",
  "url_bloque": "https://..."
}
```

## 🔄 Flujos de Datos

### DAG 1: boe_sync_consolidada (Diario, 2 AM)

```
discover_normas
  ↓
  - Llama a API BOE: list_normas(from=ayer, to=hoy)
  - Upsert en boe_norma
  - Retorna lista de id_norma

sync_indices
  ↓
  - Para cada id_norma: get_indice()
  - Upsert boe_bloque
  - Detecta bloques "dirty" (fecha_actualizacion cambió)
  - Retorna lista de (id_norma, id_bloque) dirty

sync_bloques_batch
  ↓
  - Para cada bloque dirty: get_bloque()
  - Parse versiones HTML → texto
  - Chunk por artículo/tamaño
  - Genera IDs deterministas
  - Upsert boe_version + boe_fragmento
  - Añade a pending_embeddings
```

### DAG 2: rag_embed_and_index (Cada hora)

```
fetch_and_embed_pending
  ↓
  - Fetch batch de pending_embeddings (status=pending)
  - Generar embeddings con Ollama
  - Upsert a boe_historico_all con ID determinista
  - Marcar como completed

refresh_vigente_collection
  ↓
  - Calcular vigencia_hasta (con ventana de siguiente versión)
  - Seleccionar versiones vigentes HOY
  - Upsert SOLO esas versiones a boe_vigente_latest

cleanup_failed
  ↓
  - Marcar como failed_permanent si attempts >= 5
  - Resetear failed → pending para retry
```

## 🔧 Idempotencia Determinista

### IDs Deterministas

```python
# ID de versión
id_version = SHA256(
    id_norma + id_bloque + fecha_vigencia_desde + 
    id_norma_modificadora + hash_html
)

# ID de fragmento
id_fragmento = SHA256(
    id_version + ordinal + hash_texto
)
```

### Ventajas

- ✅ No hay duplicados si se reejecuta el DAG
- ✅ Mismo fragmento siempre tiene el mismo ID
- ✅ Upsert en Qdrant con el mismo ID actualiza (no duplica)
- ✅ Permite recuperación de fallos sin estado externo

## 🛠️ Comandos Útiles

```bash
# Inicialización completa
make init

# Iniciar/detener servicios
make up
make down

# Ver logs
make logs
make logs-api
make logs-airflow

# Smoke test
docker compose exec rag-api python /app/../scripts/smoke_test.py

# Ejecutar tests unitarios (TODO)
make test

# Backup/restore
make backup-db
make restore-db FILE=backup.sql

# Shell a contenedores
make shell-api
make shell-airflow
make shell-postgres
```

## 📁 Estructura del Proyecto

```
.
├── docker-compose.yml          # Orquestación de servicios
├── .env.example               # Variables de entorno
├── Makefile                   # Comandos útiles
│
├── airflow/
│   ├── dags/
│   │   ├── boe_sync_consolidada.py      # Sincronización diaria
│   │   ├── rag_embed_and_index.py       # Embeddings + indexación
│   │   └── utils/
│   │       ├── boe_consolidada_client.py  # Cliente API BOE
│   │       ├── text_processing.py         # HTML → texto, chunking
│   │       ├── idempotency.py             # IDs deterministas
│   │       └── embeddings.py              # Qdrant + Ollama
│   └── requirements.txt
│
├── rag-api/
│   ├── app/
│   │   ├── main.py              # FastAPI endpoints
│   │   ├── embeddings.py        # Search vigente/historico
│   │   ├── llm.py              # Generación de respuestas
│   │   └── database.py         # Conexiones Postgres
│   └── requirements.txt
│
├── postgres/
│   └── init/
│       └── init.sql            # Schema completo
│
├── scripts/
│   └── smoke_test.py           # Test de extremo a extremo
│
└── tests/
    └── test_api.py             # Tests unitarios (TODO)
```

## 🔐 Configuración Avanzada

### Variables de Entorno (.env)

```bash
# PostgreSQL
POSTGRES_USER=postgres
POSTGRES_PASSWORD=<secure-password>
POSTGRES_DB=boe_legislation

# Qdrant Collections
QDRANT_COLLECTION_HIST=boe_historico_all
QDRANT_COLLECTION_VIG=boe_vigente_latest

# Ollama Models
OLLAMA_EMBEDDING_MODEL=nomic-embed-text  # 768 dim
OLLAMA_GENERATION_MODEL=llama3.2

# BOE API
BOE_CONSOLIDADA_BASE_URL=https://www.boe.es/datosabiertos/api/legislacion
```

### GPU para Ollama

Si NO tienes GPU, elimina la sección `deploy.resources` en `docker-compose.yml`:

```yaml
ollama:
  # ... otras configuraciones
  # deploy:  # <-- comentar o eliminar esta sección
  #   resources:
  #     reservations:
  #       devices:
  #         - driver: nvidia
  #           count: all
  #           capabilities: [gpu]
```

## 🐛 Troubleshooting

### Error: "Collection not found"

```bash
# Crear colecciones manualmente
docker compose exec rag-api python -c "
from app.embeddings import ensure_collections_exist
ensure_collections_exist()
"
```

### Error: "No embeddings model"

```bash
# Descargar modelo
docker compose exec ollama ollama pull nomic-embed-text
docker compose exec ollama ollama pull llama3.2
```

### DAG no ejecuta

1. Verifica que Airflow scheduler está corriendo: `docker compose ps`
2. Revisa logs: `docker compose logs airflow-scheduler`
3. Verifica que el DAG no está pausado en la UI

### Sin datos en Qdrant

1. Verifica pending_embeddings: `SELECT status, COUNT(*) FROM pending_embeddings GROUP BY status;`
2. Si hay muchos "failed", revisa errores: `SELECT DISTINCT last_error FROM pending_embeddings WHERE status='failed';`
3. Reintenta: DAG `rag_embed_and_index` marcará failed → pending automáticamente

## 📚 Referencias

- [API BOE Legislación Consolidada](https://www.boe.es/datosabiertos/documentacion/legislacion-consolidada)
- [Qdrant Documentation](https://qdrant.tech/documentation/)
- [Ollama Models](https://ollama.com/library)
- [Apache Airflow](https://airflow.apache.org/)

## 🤝 Contribuciones

Las contribuciones son bienvenidas. Ver [CONTRIBUTING.md](CONTRIBUTING.md).

## 📝 Licencia

[Especificar licencia]

## 📧 Contacto

[Tu información de contacto]
