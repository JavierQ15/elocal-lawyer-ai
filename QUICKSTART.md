# 🚀 Quickstart Guide

Get the BOE Legislation RAG System up and running in 5 minutes!

## Prerequisites

- Docker & Docker Compose installed
- 16GB+ RAM
- 50GB+ disk space

## Step 1: Clone & Setup (1 minute)

```bash
git clone https://github.com/JavierQ15/elocal-lawyer-ai.git
cd elocal-lawyer-ai
make init
```

This command will:
- Copy `.env.example` to `.env`
- Generate secure keys
- Build all Docker images
- Start all services
- Download Ollama models

## Step 2: Verify Services (30 seconds)

```bash
make status
```

Expected output: All services should be "Up" and "healthy"

## Step 3: Access Interfaces

Open in your browser:

| Service | URL | Credentials |
|---------|-----|-------------|
| Airflow UI | http://localhost:8080 | admin/admin |
| API Documentation | http://localhost:8000/docs | - |
| Qdrant Dashboard | http://localhost:6333/dashboard | - |

## Step 4: Load Data (Varies by data volume)

1. Open Airflow UI: http://localhost:8080
2. Find the `boe_initial_load` DAG
3. Toggle it ON (switch on left)
4. Click the ▶ button to trigger

Watch the progress in the Graph view.

## Step 5: Test the API (30 seconds)

```bash
# Health check
curl http://localhost:8000/health

# Get statistics
curl http://localhost:8000/stats

# Make a query (after data is loaded)
curl -X POST http://localhost:8000/query \
  -H "Content-Type: application/json" \
  -d '{
    "question": "¿Qué dice la legislación sobre protección de datos?",
    "max_results": 5
  }'
```

## Common Commands

```bash
make help          # Show all commands
make up            # Start services
make down          # Stop services
make logs          # View all logs
make logs-api      # View API logs
make logs-airflow  # View Airflow logs
make restart       # Restart all services
make clean         # Remove all data (careful!)
```

## Troubleshooting

### Services won't start
```bash
make logs          # Check error messages
docker system prune # Clean up Docker
make init          # Try again
```

### Can't access Airflow
- Wait 30-60 seconds after `make up`
- Check logs: `make logs-airflow`
- Verify port 8080 is not in use

### API returns empty results
- Make sure data is loaded (run `boe_initial_load` DAG)
- Check database: `make shell-postgres`

### Out of memory
- Check available RAM: `free -h`
- Reduce resource limits in `docker-compose.yml`
- Close other applications

## Next Steps

1. **Load your data**: Run the initial load DAG in Airflow
2. **Explore the API**: Visit http://localhost:8000/docs
3. **Check the docs**: Read `docs/` for detailed guides
4. **Customize**: Edit `.env` for your configuration

## Architecture Overview

```
User Request
    ↓
FastAPI (Port 8000)
    ↓
Generate Query Embedding (Ollama)
    ↓
Search Similar Vectors (Qdrant)
    ↓
Retrieve Full Context (PostgreSQL)
    ↓
Generate Answer (Ollama LLM)
    ↓
Return Answer + Sources
```

## Data Pipeline

```
Airflow Scheduler
    ↓
Fetch BOE Documents
    ↓
Calculate Hash (Idempotency Check)
    ↓
Store in PostgreSQL
    ↓
Chunk Text
    ↓
Generate Embeddings (Ollama)
    ↓
Store Vectors in Qdrant
    ↓
Schedule Next Run (Daily)
```

## File Structure

```
elocal-lawyer-ai/
├── airflow/              # Data pipeline
├── rag-api/             # REST API
├── postgres/            # Database init
├── docs/                # Documentation
├── docker-compose.yml   # Services
├── Makefile            # Commands
└── README.md           # Full guide
```

## Getting Help

- 📖 Full README: `README.md`
- 🏗️ Architecture: `docs/ARCHITECTURE.md`
- 🚀 Deployment: `docs/DEPLOYMENT.md`
- 📡 API Usage: `docs/API_USAGE.md`
- 🐛 Issues: GitHub Issues

---

**🎉 You're all set! Happy querying!**
