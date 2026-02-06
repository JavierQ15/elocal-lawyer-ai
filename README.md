# BOE Legislation RAG System

Sistema RAG (Retrieval-Augmented Generation) para consultar legislación consolidada del BOE (Boletín Oficial del Estado de España).

## 🏗️ Arquitectura

El sistema utiliza las siguientes tecnologías:

- **PostgreSQL**: Base de datos principal (source of truth) para almacenar documentos del BOE
- **Qdrant**: Base de datos vectorial para búsqueda semántica
- **Apache Airflow**: Orquestación de pipelines de ingesta de datos (carga inicial e incremental)
- **Ollama**: Modelos LLM locales para embeddings y generación de respuestas
- **FastAPI**: API REST para consultas RAG
- **Docker Compose**: Orquestación de todos los servicios con persistencia

## 🚀 Características

- ✅ **Carga inicial completa** de documentos del BOE
- ✅ **Actualizaciones incrementales** diarias automáticas
- ✅ **Idempotencia** basada en hashes SHA256 (evita duplicados)
- ✅ **Volúmenes persistentes** para todos los datos
- ✅ **Búsqueda semántica** con embeddings
- ✅ **API REST** con documentación interactiva
- ✅ **Monitoreo** a través de interfaz web de Airflow

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

Ejecutar el comando de inicialización completa:

```bash
make init
```

Este comando realizará automáticamente:
- Copia `.env.example` a `.env` y genera claves secretas
- Construye todas las imágenes Docker
- Inicia todos los servicios
- Descarga los modelos de Ollama necesarios

**Nota**: El primer inicio puede tardar 10-15 minutos dependiendo de tu conexión a internet, ya que descarga modelos LLM grandes.

### 3. Verificar servicios

Una vez completada la inicialización, verifica que todos los servicios estén funcionando:

```bash
make status
```

### 4. Acceder a las interfaces

- **Airflow UI**: http://localhost:8080
  - Usuario: `admin`
  - Contraseña: `admin`
  
- **RAG API (Swagger)**: http://localhost:8000/docs

- **Qdrant Dashboard**: http://localhost:6333/dashboard

### 5. Ejecutar carga inicial de datos

1. Accede a Airflow UI (http://localhost:8080)
2. Busca el DAG `boe_initial_load`
3. Activa el DAG (toggle en la columna izquierda)
4. Haz clic en el botón "▶" para ejecutar manualmente

El proceso de carga inicial puede tardar dependiendo del volumen de datos configurado.

### 6. Probar la API

```bash
# Verificar salud del sistema
curl http://localhost:8000/health

# Obtener estadísticas
curl http://localhost:8000/stats

# Listar documentos
curl http://localhost:8000/documents

# Hacer una consulta RAG
curl -X POST http://localhost:8000/query \
  -H "Content-Type: application/json" \
  -d '{
    "question": "¿Qué dice la legislación sobre protección de datos?",
    "max_results": 5
  }'
```

## 🛠️ Comandos Útiles (Makefile)

```bash
# Ver todos los comandos disponibles
make help

# Inicialización completa (solo primera vez)
make init

# Iniciar servicios
make up

# Detener servicios
make down

# Ver logs de todos los servicios
make logs

# Ver logs de un servicio específico
make logs-api        # RAG API
make logs-airflow    # Airflow
make logs-postgres   # PostgreSQL
make logs-qdrant     # Qdrant
make logs-ollama     # Ollama

# Reiniciar servicios
make restart

# Limpiar todo (¡cuidado! elimina volúmenes)
make clean

# Descargar modelos de Ollama
make pull-models

# Ejecutar tests
make test

# Acceder a shells
make shell-api       # Shell del contenedor API
make shell-airflow   # Shell del contenedor Airflow
make shell-postgres  # Shell de PostgreSQL

# Backup y restore
make backup-db
make restore-db FILE=backup.sql
```

## 📁 Estructura del Proyecto

```
.
├── docker-compose.yml          # Configuración de servicios
├── .env.example               # Variables de entorno de ejemplo
├── Makefile                   # Comandos útiles
├── README.md                  # Este archivo
│
├── airflow/                   # Configuración de Airflow
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── dags/                  # DAGs de Airflow
│   │   ├── boe_initial_load.py       # Carga inicial
│   │   ├── boe_incremental_update.py # Actualización incremental
│   │   └── utils/             # Utilidades compartidas
│   │       ├── boe_scraper.py
│   │       ├── embeddings.py
│   │       ├── idempotency.py
│   │       └── text_processing.py
│   ├── logs/                  # Logs de Airflow
│   └── plugins/               # Plugins de Airflow
│
├── rag-api/                   # API FastAPI
│   ├── Dockerfile
│   ├── requirements.txt
│   └── app/
│       ├── main.py            # Punto de entrada
│       ├── database.py        # Conexiones DB
│       ├── embeddings.py      # Generación de embeddings
│       └── llm.py            # Generación de respuestas
│
├── postgres/                  # PostgreSQL
│   └── init/
│       └── init.sql          # Script de inicialización
│
└── data/                     # Datos persistentes (gitignored)
```

## 🔄 Pipelines de Datos

### Carga Inicial (`boe_initial_load`)

DAG de Airflow que realiza la carga inicial completa:

1. **Fetch documents**: Obtiene documentos del BOE de un período definido
2. **Store in PostgreSQL**: Almacena documentos con hash SHA256 para idempotencia
3. **Chunk texts**: Divide documentos en fragmentos con overlap
4. **Generate embeddings**: Genera embeddings usando Ollama
5. **Store in Qdrant**: Almacena vectores en Qdrant

### Actualización Incremental (`boe_incremental_update`)

DAG que se ejecuta diariamente (2 AM) para actualizar con nuevos documentos:

1. Obtiene documentos del día anterior
2. Compara hashes para detectar cambios
3. Actualiza o inserta según sea necesario
4. Regenera embeddings para documentos modificados

### Idempotencia

El sistema usa hashes SHA256 para garantizar idempotencia:
- **Documentos**: Hash del contenido completo
- **Chunks**: Hash de cada fragmento
- No se procesan documentos/chunks duplicados

## 📊 Base de Datos

### PostgreSQL - Schema Principal

```sql
-- Documentos del BOE (source of truth)
boe_documents
  - id (UUID)
  - boe_id (VARCHAR, UNIQUE)
  - title, summary, full_text
  - content_hash (SHA256 para idempotencia)
  - publication_date, document_type
  - department, section
  - url, pdf_url
  - metadata (JSONB)
  - created_at, updated_at

-- Fragmentos de documentos
document_chunks
  - id (UUID)
  - document_id (FK)
  - chunk_index, chunk_text
  - chunk_hash (SHA256 para idempotencia)
  - vector_id (referencia a Qdrant)
  - metadata (JSONB)

-- Log de ingestión
ingestion_log
  - id, boe_id
  - status (pending/processing/completed/failed)
  - ingestion_type (initial/incremental)
  - error_message
  - started_at, completed_at
```

## 🔧 Configuración

### Variables de Entorno (.env)

```bash
# PostgreSQL
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=boe_legislation
POSTGRES_PORT=5432

# Qdrant
QDRANT_PORT=6333
QDRANT_COLLECTION_NAME=boe_legislation

# Ollama
OLLAMA_PORT=11434
OLLAMA_EMBEDDING_MODEL=nomic-embed-text
OLLAMA_GENERATION_MODEL=llama3.2

# Airflow
AIRFLOW_WWW_USER_USERNAME=admin
AIRFLOW_WWW_USER_PASSWORD=admin
# ... (claves generadas automáticamente)

# RAG API
RAG_API_PORT=8000
```

### Modelos Ollama

El sistema utiliza dos modelos:

- **nomic-embed-text**: Para generar embeddings (768 dimensiones)
- **llama3.2**: Para generación de respuestas

Puedes cambiar estos modelos editando el archivo `.env` y volviendo a ejecutar:

```bash
make pull-models
```

## 🐛 Troubleshooting

### Los servicios no inician

```bash
# Ver logs detallados
make logs

# Verificar estado
docker-compose ps

# Reiniciar desde cero
make clean
make init
```

### Error de conexión con Ollama

```bash
# Verificar que Ollama está corriendo
docker-compose ps ollama

# Verificar modelos descargados
docker-compose exec ollama ollama list

# Descargar modelos manualmente
make pull-models
```

### Base de datos sin datos

1. Verifica que el DAG `boe_initial_load` se haya ejecutado en Airflow
2. Revisa los logs de Airflow: `make logs-airflow`
3. Ejecuta manualmente el DAG desde la UI de Airflow

### Sin GPU disponible

El sistema funciona sin GPU, pero será más lento. Para deshabilitar GPU:

1. Edita `docker-compose.yml`
2. Elimina la sección `deploy.resources` del servicio `ollama`
3. Reinicia: `make restart`

## 📈 Rendimiento

### Recomendaciones

- **Memoria**: Mínimo 16GB, recomendado 32GB
- **CPU**: Mínimo 4 cores, recomendado 8+ cores
- **Disco**: SSD recomendado para mejor rendimiento de Postgres/Qdrant
- **GPU**: NVIDIA con 8GB+ VRAM para mejor rendimiento de Ollama

### Optimizaciones

- Ajusta `chunk_size` y `overlap` en los DAGs según tus necesidades
- Modifica `temperature` en las consultas para controlar creatividad
- Usa modelos más pequeños de Ollama si tienes limitaciones de recursos

## 🔐 Seguridad

- Cambia las contraseñas por defecto en `.env`
- No expongas los puertos a internet sin autenticación adicional
- Usa HTTPS en producción con un reverse proxy (nginx/traefik)
- Implementa rate limiting en la API

## 📝 Licencia

[Especificar licencia]

## 🤝 Contribuciones

Las contribuciones son bienvenidas. Por favor:

1. Fork el proyecto
2. Crea una rama para tu feature (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abre un Pull Request

## 📧 Contacto

[Tu información de contacto]

## 🙏 Agradecimientos

- BOE (Boletín Oficial del Estado) por proporcionar datos abiertos
- Comunidad de Airflow, FastAPI, Qdrant y Ollama