"""
Utility functions for generating embeddings and storing in Qdrant.
"""
import os
import requests
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct
import uuid


OLLAMA_HOST = os.getenv('OLLAMA_HOST', 'ollama')
OLLAMA_PORT = os.getenv('OLLAMA_PORT', '11434')
OLLAMA_EMBEDDING_MODEL = os.getenv('OLLAMA_EMBEDDING_MODEL', 'nomic-embed-text')
QDRANT_HOST = os.getenv('QDRANT_HOST', 'qdrant')
QDRANT_PORT = int(os.getenv('QDRANT_PORT', '6333'))
QDRANT_COLLECTION_NAME = os.getenv('QDRANT_COLLECTION_NAME', 'boe_legislation')


def get_qdrant_client():
    """Get Qdrant client instance."""
    return QdrantClient(host=QDRANT_HOST, port=QDRANT_PORT)


def ensure_collection_exists():
    """
    Ensure the Qdrant collection exists.
    Creates it if it doesn't exist.
    """
    client = get_qdrant_client()
    
    collections = client.get_collections().collections
    collection_names = [c.name for c in collections]
    
    if QDRANT_COLLECTION_NAME not in collection_names:
        # Create collection with appropriate vector size
        # nomic-embed-text produces 768-dimensional vectors
        client.create_collection(
            collection_name=QDRANT_COLLECTION_NAME,
            vectors_config=VectorParams(size=768, distance=Distance.COSINE),
        )
        print(f"Created collection: {QDRANT_COLLECTION_NAME}")


def generate_embeddings(text):
    """
    Generate embeddings for text using Ollama.
    
    Args:
        text: Text to embed
        
    Returns:
        List of float values representing the embedding
    """
    try:
        url = f"http://{OLLAMA_HOST}:{OLLAMA_PORT}/api/embeddings"
        payload = {
            "model": OLLAMA_EMBEDDING_MODEL,
            "prompt": text
        }
        
        response = requests.post(url, json=payload, timeout=60)
        response.raise_for_status()
        
        result = response.json()
        return result['embedding']
    except Exception as e:
        print(f"Error generating embeddings: {e}")
        # Return a zero vector as fallback
        return [0.0] * 768


def store_in_qdrant(embedding, text, metadata):
    """
    Store embedding and metadata in Qdrant.
    
    Args:
        embedding: Vector embedding
        text: Original text
        metadata: Dictionary of metadata
        
    Returns:
        Vector ID (UUID string)
    """
    ensure_collection_exists()
    
    client = get_qdrant_client()
    vector_id = str(uuid.uuid4())
    
    # Add text to metadata
    full_metadata = {
        'text': text,
        **metadata
    }
    
    point = PointStruct(
        id=vector_id,
        vector=embedding,
        payload=full_metadata
    )
    
    client.upsert(
        collection_name=QDRANT_COLLECTION_NAME,
        points=[point]
    )
    
    return vector_id


def search_similar(query_text, limit=5):
    """
    Search for similar documents in Qdrant.
    
    Args:
        query_text: Query text
        limit: Number of results to return
        
    Returns:
        List of search results
    """
    # Generate embedding for query
    query_embedding = generate_embeddings(query_text)
    
    client = get_qdrant_client()
    
    search_result = client.search(
        collection_name=QDRANT_COLLECTION_NAME,
        query_vector=query_embedding,
        limit=limit
    )
    
    return search_result
