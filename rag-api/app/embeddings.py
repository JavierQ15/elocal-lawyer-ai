"""
Embedding generation and vector search utilities.
"""
import os
import requests
from qdrant_client import QdrantClient
from typing import List


OLLAMA_HOST = os.getenv('OLLAMA_HOST', 'ollama')
OLLAMA_PORT = os.getenv('OLLAMA_PORT', '11434')
OLLAMA_EMBEDDING_MODEL = os.getenv('OLLAMA_EMBEDDING_MODEL', 'nomic-embed-text')
QDRANT_HOST = os.getenv('QDRANT_HOST', 'qdrant')
QDRANT_PORT = int(os.getenv('QDRANT_PORT', '6333'))
QDRANT_COLLECTION_NAME = os.getenv('QDRANT_COLLECTION_NAME', 'boe_legislation')


def get_qdrant_client():
    """Get Qdrant client instance."""
    return QdrantClient(host=QDRANT_HOST, port=QDRANT_PORT)


def generate_embedding(text: str) -> List[float]:
    """
    Generate embedding for text using Ollama.
    
    Args:
        text: Text to embed
        
    Returns:
        List of float values representing the embedding
    """
    url = f"http://{OLLAMA_HOST}:{OLLAMA_PORT}/api/embeddings"
    payload = {
        "model": OLLAMA_EMBEDDING_MODEL,
        "prompt": text
    }
    
    response = requests.post(url, json=payload, timeout=60)
    response.raise_for_status()
    
    result = response.json()
    return result['embedding']


def search_vectors(query_embedding: List[float], limit: int = 5):
    """
    Search for similar vectors in Qdrant.
    
    Args:
        query_embedding: Query vector
        limit: Number of results to return
        
    Returns:
        List of search results
    """
    client = get_qdrant_client()
    
    search_result = client.search(
        collection_name=QDRANT_COLLECTION_NAME,
        query_vector=query_embedding,
        limit=limit
    )
    
    return search_result
