# Architecture Overview

This document describes the architecture of the BOE Legislation RAG System.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         External Services                            │
│                                                                       │
│  ┌──────────────────────┐                                           │
│  │   BOE Website/API    │  (Data Source)                            │
│  └──────────┬───────────┘                                           │
└─────────────┼─────────────────────────────────────────────────────┘
              │
              │ HTTP/XML
              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        Ingestion Layer                               │
│                                                                       │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │                   Apache Airflow                            │    │
│  │                                                             │    │
│  │  ┌─────────────────┐        ┌──────────────────────┐     │    │
│  │  │ Initial Load    │        │ Incremental Update   │     │    │
│  │  │ DAG             │        │ DAG (Daily)          │     │    │
│  │  └────────┬────────┘        └──────────┬───────────┘     │    │
│  │           │                             │                 │    │
│  │           └──────────┬──────────────────┘                 │    │
│  └──────────────────────┼────────────────────────────────────┘    │
└─────────────────────────┼──────────────────────────────────────────┘
                          │
                          ▼
          ┌───────────────────────────────┐
          │   Document Processing         │
          │   - Fetch documents           │
          │   - Calculate content hash    │
          │   - Check idempotency         │
          │   - Chunk text (1000 chars)   │
          │   - Generate embeddings       │
          └───────────┬───────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         Storage Layer                                │
│                                                                       │
│  ┌──────────────────────┐          ┌──────────────────────┐        │
│  │    PostgreSQL        │          │      Qdrant          │        │
│  │  (Source of Truth)   │          │  (Vector Store)      │        │
│  │                      │          │                      │        │
│  │  ┌────────────────┐  │          │  ┌────────────────┐  │        │
│  │  │ boe_documents  │  │          │  │ Embeddings     │  │        │
│  │  │ - id           │  │          │  │ Collection     │  │        │
│  │  │ - boe_id       │  │          │  │ (768-dim)      │  │        │
│  │  │ - content_hash │  │          │  │                │  │        │
│  │  │ - full_text    │  │          │  └────────────────┘  │        │
│  │  │ - metadata     │  │          │                      │        │
│  │  └────────────────┘  │          └──────────────────────┘        │
│  │                      │                                           │
│  │  ┌────────────────┐  │                                           │
│  │  │document_chunks │  │                                           │
│  │  │ - document_id  │  │                                           │
│  │  │ - chunk_text   │  │                                           │
│  │  │ - chunk_hash   │  │                                           │
│  │  │ - vector_id    │────────────────┐                            │
│  │  └────────────────┘  │              │                            │
│  │                      │              │ References                 │
│  │  ┌────────────────┐  │              │                            │
│  │  │ ingestion_log  │  │              │                            │
│  │  └────────────────┘  │              │                            │
│  └──────────────────────┘              │                            │
└────────────────────────────────────────┼────────────────────────────┘
                                         │
                                         │
┌─────────────────────────────────────────────────────────────────────┐
│                       Generation Layer                               │
│                                                                       │
│  ┌──────────────────────────────────────────────────────────┐      │
│  │                       Ollama                             │      │
│  │                                                          │      │
│  │  ┌─────────────────────┐    ┌──────────────────────┐   │      │
│  │  │ nomic-embed-text    │    │    llama3.2          │   │      │
│  │  │ (Embedding Model)   │    │ (Generation Model)   │   │      │
│  │  │ 768 dimensions      │    │                      │   │      │
│  │  └─────────────────────┘    └──────────────────────┘   │      │
│  └──────────────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        API Layer                                     │
│                                                                       │
│  ┌──────────────────────────────────────────────────────────┐      │
│  │                    FastAPI (RAG API)                     │      │
│  │                                                          │      │
│  │  Endpoints:                                              │      │
│  │  • POST /query        - RAG query                       │      │
│  │  • GET  /documents    - List documents                  │      │
│  │  • GET  /documents/:id - Get document                   │      │
│  │  • GET  /stats        - Statistics                      │      │
│  │  • GET  /health       - Health check                    │      │
│  └──────────────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────────┘
                          │
                          ▼
                    ┌──────────┐
                    │  Clients │
                    └──────────┘
```

## Component Details

### 1. Ingestion Layer (Apache Airflow)

**Purpose**: Orchestrate data ingestion and updates

**Components**:
- **Airflow Scheduler**: Executes DAGs on schedule
- **Airflow Webserver**: Provides UI for monitoring
- **Airflow Database**: Stores DAG state and metadata

**DAGs**:
1. **boe_initial_load**: One-time full data load
2. **boe_incremental_update**: Daily updates (runs at 2 AM)

**Data Flow**:
1. Fetch documents from BOE
2. Calculate SHA256 hash of content
3. Check if document exists with same hash (idempotency)
4. Insert/update in PostgreSQL
5. Chunk document into smaller pieces
6. Generate embeddings for each chunk
7. Store embeddings in Qdrant
8. Link chunks to vectors

### 2. Storage Layer

#### PostgreSQL (Source of Truth)

**Purpose**: Store all BOE documents and metadata

**Tables**:
- `boe_documents`: Full documents with metadata
- `document_chunks`: Text chunks with references to vectors
- `ingestion_log`: Track ingestion jobs

**Key Features**:
- Content hash for idempotency
- JSONB for flexible metadata
- Foreign key constraints for data integrity
- Indexes for performance

#### Qdrant (Vector Store)

**Purpose**: Store and search document embeddings

**Collection**: `boe_legislation`
- Vector size: 768 dimensions
- Distance metric: Cosine similarity
- Metadata: document_id, chunk_index, title, etc.

### 3. Generation Layer (Ollama)

**Purpose**: Generate embeddings and responses

**Models**:
1. **nomic-embed-text**:
   - Type: Embedding model
   - Output: 768-dimensional vectors
   - Use: Convert text to embeddings

2. **llama3.2**:
   - Type: Language model
   - Use: Generate natural language responses
   - Context: Retrieved document chunks

### 4. API Layer (FastAPI)

**Purpose**: Provide REST API for querying

**Query Flow**:
1. Receive user question
2. Generate question embedding
3. Search Qdrant for similar vectors
4. Retrieve full context from PostgreSQL
5. Generate answer with Ollama
6. Return answer with sources

## Data Flow: RAG Query

```
User Query
    ↓
[1] Generate Query Embedding (Ollama)
    ↓
[2] Vector Search (Qdrant)
    ↓ (top-k similar vectors)
[3] Retrieve Full Context (PostgreSQL)
    ↓ (document chunks + metadata)
[4] Generate Response (Ollama + LLM)
    ↓
Response + Sources
```

## Idempotency Strategy

### Document-Level
- Calculate SHA256 hash of full text
- Store in `content_hash` column
- Skip if document exists with same hash
- Update if document exists with different hash

### Chunk-Level
- Calculate SHA256 hash of chunk text
- Store in `chunk_hash` column
- Skip if chunk exists with same hash

### Benefits
- Avoid duplicate processing
- Efficient incremental updates
- Data consistency
- Cost savings (less API calls)

## Persistence

All data is persisted using Docker volumes:

```yaml
volumes:
  postgres_data:      # PostgreSQL database
  qdrant_data:        # Qdrant vectors
  ollama_data:        # Ollama models
  airflow_postgres_data:  # Airflow metadata
```

## Scaling Considerations

### Horizontal Scaling
- **Airflow**: Add worker nodes
- **Qdrant**: Cluster mode
- **API**: Multiple replicas behind load balancer

### Vertical Scaling
- **PostgreSQL**: Increase memory for larger datasets
- **Qdrant**: More RAM for faster vector search
- **Ollama**: GPU for faster inference

## Security

### Current State
- Basic authentication for Airflow
- No authentication on API (development)
- Internal Docker network

### Production Recommendations
- Add JWT authentication to API
- Use secrets management (e.g., Vault)
- Enable SSL/TLS
- Implement rate limiting
- Add API key management

## Monitoring

### Available Interfaces
- **Airflow UI**: Monitor DAG runs
- **Qdrant Dashboard**: View collections
- **FastAPI Docs**: API documentation
- **Docker Logs**: Service logs

### Recommended Additions
- Prometheus for metrics
- Grafana for dashboards
- ELK stack for log aggregation
- Alert manager for notifications

## Performance Metrics

### Expected Performance
- **Ingestion**: ~100-1000 docs/hour (depends on BOE API)
- **Embedding**: ~10-50 docs/minute (depends on GPU)
- **Query Latency**: 1-5 seconds (embedding + search + generation)
- **Search**: <100ms for vector search

### Optimization Opportunities
- Batch embedding generation
- Caching frequent queries
- Pre-computed embeddings
- Index optimization
