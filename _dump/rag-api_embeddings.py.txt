"""
Embedding generation and vector search utilities.
Supports searching in both vigente and historical collections with date filtering.
"""
import os
import requests
from qdrant_client import QdrantClient
from qdrant_client.models import Filter, FieldCondition, Range, MatchValue
from typing import List
from datetime import date


OLLAMA_HOST = os.getenv('OLLAMA_HOST', 'ollama')
OLLAMA_PORT = os.getenv('OLLAMA_PORT', '11434')
OLLAMA_EMBEDDING_MODEL = os.getenv('OLLAMA_EMBEDDING_MODEL', 'nomic-embed-text')
QDRANT_HOST = os.getenv('QDRANT_HOST', 'qdrant')
QDRANT_PORT = int(os.getenv('QDRANT_PORT', '6333'))

# Two collections
QDRANT_COLLECTION_HIST = os.getenv('QDRANT_COLLECTION_HIST', 'boe_historico_all')
QDRANT_COLLECTION_VIG = os.getenv('QDRANT_COLLECTION_VIG', 'boe_vigente_latest')

# Legacy collection
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
    Search for similar vectors in Qdrant (legacy function).
    
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


def search_vigente(query_embedding: List[float], limit: int = 5):
    """
    Search in the vigente (current) legislation collection.
    
    Args:
        query_embedding: Query vector
        limit: Number of results to return
        
    Returns:
        List of search results with scores and payloads
    """
    client = get_qdrant_client()
    
    try:
        search_result = client.search(
            collection_name=QDRANT_COLLECTION_VIG,
            query_vector=query_embedding,
            limit=limit
        )
        return search_result
    except Exception as e:
        print(f"Error searching vigente collection: {e}")
        return []


def search_historico(
    query_embedding: List[float],
    as_of_date: date,
    limit: int = 5
):
    """
    Search in the historical collection filtered by date.
    
    Returns legislation that was valid as of the given date:
    - vigencia_desde <= as_of_date
    - vigencia_hasta IS NULL OR vigencia_hasta >= as_of_date
    
    Args:
        query_embedding: Query vector
        as_of_date: Reference date for filtering
        limit: Number of results to return
        
    Returns:
        List of search results with scores and payloads
    """
    client = get_qdrant_client()
    
    try:
        as_of_timestamp = as_of_date.isoformat()
        
        # Build filter
        filter_conditions = Filter(
            must=[
                FieldCondition(
                    key="vigencia_desde",
                    range=Range(lte=as_of_timestamp)
                )
            ],
            should=[
                # vigencia_hasta IS NULL (valid indefinitely)
                FieldCondition(
                    key="vigencia_hasta",
                    match=MatchValue(value=None)
                ),
                # vigencia_hasta >= as_of_date
                FieldCondition(
                    key="vigencia_hasta",
                    range=Range(gte=as_of_timestamp)
                )
            ],
            min_should_match=1
        )
        
        search_result = client.search(
            collection_name=QDRANT_COLLECTION_HIST,
            query_vector=query_embedding,
            query_filter=filter_conditions,
            limit=limit
        )
        return search_result
    except Exception as e:
        print(f"Error searching historico collection: {e}")
        return []
