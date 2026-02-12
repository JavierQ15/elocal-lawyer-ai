#!/bin/bash
# Initialize Ollama with embedding and chat models used by this repo.

set -euo pipefail

echo "Waiting for Ollama to be ready..."
until docker compose exec ollama ollama list > /dev/null 2>&1; do
  echo "Ollama is not ready yet, waiting..."
  sleep 2
done

echo "Pulling embedding model qwen3-embedding:8b..."
docker compose exec ollama ollama pull qwen3-embedding:8b

echo "Pulling chat model qwen2.5:7b-instruct for /rag/answer..."
docker compose exec ollama ollama pull qwen2.5:7b-instruct

echo "Models installed. Available models:"
docker compose exec ollama ollama list
