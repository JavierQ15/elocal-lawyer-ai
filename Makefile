.PHONY: help setup up down restart logs clean init-db pull-models test

help: ## Show this help message
	@echo 'Usage: make [target]'
	@echo ''
	@echo 'Available targets:'
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

setup: ## Initial setup - copy .env.example to .env and generate keys
	@if [ ! -f .env ]; then \
		cp .env.example .env; \
		echo "Created .env file from .env.example"; \
		echo "Generating Fernet key..."; \
		python3 -c "from cryptography.fernet import Fernet; print('AIRFLOW_FERNET_KEY=' + Fernet.generate_key().decode())" >> .env.tmp; \
		echo "Generating secret key..."; \
		SECRET_KEY=$$(openssl rand -hex 32); \
		echo "AIRFLOW_SECRET_KEY=$$SECRET_KEY" >> .env.tmp; \
		sed -i.bak '/^AIRFLOW_FERNET_KEY=/d' .env; \
		sed -i.bak '/^AIRFLOW_SECRET_KEY=/d' .env; \
		cat .env.tmp >> .env; \
		rm .env.tmp .env.bak; \
		echo "Generated keys and updated .env file"; \
	else \
		echo ".env file already exists"; \
	fi

build: ## Build all Docker images
	docker-compose build

up: ## Start all services
	docker-compose up -d

down: ## Stop all services
	docker-compose down

restart: ## Restart all services
	docker-compose restart

logs: ## Show logs from all services
	docker-compose logs -f

logs-api: ## Show logs from RAG API
	docker-compose logs -f rag-api

logs-airflow: ## Show logs from Airflow
	docker-compose logs -f airflow-webserver airflow-scheduler

logs-postgres: ## Show logs from PostgreSQL
	docker-compose logs -f postgres

logs-qdrant: ## Show logs from Qdrant
	docker-compose logs -f qdrant

logs-ollama: ## Show logs from Ollama
	docker-compose logs -f ollama

clean: ## Stop and remove all containers, networks, and volumes
	docker-compose down -v
	rm -rf airflow/logs/*

init-db: ## Initialize the PostgreSQL database
	docker-compose exec postgres psql -U postgres -d boe_legislation -f /docker-entrypoint-initdb.d/init.sql

pull-models: ## Pull required Ollama models
	@echo "Pulling embedding model..."
	docker-compose exec ollama ollama pull nomic-embed-text
	@echo "Pulling generation model..."
	docker-compose exec ollama ollama pull llama3.2

init: setup build up ## Complete initialization - setup, build, and start all services
	@echo "Waiting for services to be ready..."
	@sleep 30
	@echo "Pulling Ollama models..."
	@$(MAKE) pull-models
	@echo ""
	@echo "Setup complete! Access the services at:"
	@echo "  - Airflow UI: http://localhost:8080 (admin/admin)"
	@echo "  - RAG API: http://localhost:8000/docs"
	@echo "  - Qdrant UI: http://localhost:6333/dashboard"

status: ## Show status of all services
	docker-compose ps

test-api: ## Test the RAG API
	curl -X GET http://localhost:8000/health
	@echo ""

test-qdrant: ## Test Qdrant connection
	curl -X GET http://localhost:6333/collections

test-ollama: ## Test Ollama connection
	curl -X GET http://localhost:11434/api/tags

test: test-api test-qdrant test-ollama ## Run all tests

shell-api: ## Open shell in RAG API container
	docker-compose exec rag-api /bin/bash

shell-airflow: ## Open shell in Airflow webserver container
	docker-compose exec airflow-webserver /bin/bash

shell-postgres: ## Open PostgreSQL shell
	docker-compose exec postgres psql -U postgres -d boe_legislation

backup-db: ## Backup PostgreSQL database
	docker-compose exec -T postgres pg_dump -U postgres boe_legislation > backup_$$(date +%Y%m%d_%H%M%S).sql

restore-db: ## Restore PostgreSQL database (use: make restore-db FILE=backup.sql)
	docker-compose exec -T postgres psql -U postgres boe_legislation < $(FILE)
