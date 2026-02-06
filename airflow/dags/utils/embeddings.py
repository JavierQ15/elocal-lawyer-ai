"""
Utility functions for generating embeddings and storing in Qdrant.
Supports two collections: historical (all versions) and current (vigente only).
"""
import os
import requests
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct, Filter, FieldCondition, Range, MatchValue
from datetime import date
from typing import List, Dict, Any, Optional
import uuid
import logging

logger = logging.getLogger(__name__)

OLLAMA_HOST = os.getenv('OLLAMA_HOST', 'ollama')
OLLAMA_PORT = os.getenv('OLLAMA_PORT', '11434')
OLLAMA_EMBEDDING_MODEL = os.getenv('OLLAMA_EMBEDDING_MODEL', 'nomic-embed-text')
QDRANT_HOST = os.getenv('QDRANT_HOST', 'qdrant')
QDRANT_PORT = int(os.getenv('QDRANT_PORT', '6333'))

# Two collections for historical and current legislation
QDRANT_COLLECTION_HIST = os.getenv('QDRANT_COLLECTION_HIST', 'boe_historico_all')
QDRANT_COLLECTION_VIG = os.getenv('QDRANT_COLLECTION_VIG', 'boe_vigente_latest')

# Legacy collection name (for backward compatibility)
QDRANT_COLLECTION_NAME = os.getenv('QDRANT_COLLECTION_NAME', 'boe_legislation')


def get_qdrant_client():
    """Get Qdrant client instance."""
    return QdrantClient(host=QDRANT_HOST, port=QDRANT_PORT)


def detect_embedding_dimension(model: str = OLLAMA_EMBEDDING_MODEL) -> int:
    """
    Detecta la dimensión de los embeddings del modelo.
    
    Args:
        model: Nombre del modelo de embeddings
        
    Returns:
        Dimensión de los vectores (default: 768)
    """
    try:
        # Generar un embedding de prueba para detectar dimensión
        test_embedding = generate_embeddings("test")
        return len(test_embedding)
    except Exception as e:
        logger.warning(f"Could not detect embedding dimension: {e}. Using default 768")
        return 768


def ensure_collections_exist():
    """
    Asegura que ambas colecciones de Qdrant existan.
    Crea las colecciones si no existen.
    """
    client = get_qdrant_client()
    
    collections = client.get_collections().collections
    collection_names = [c.name for c in collections]
    
    # Detectar dimensión de embeddings
    vector_size = detect_embedding_dimension()
    logger.info(f"Using vector dimension: {vector_size}")
    
    # Crear colección histórica
    if QDRANT_COLLECTION_HIST not in collection_names:
        client.create_collection(
            collection_name=QDRANT_COLLECTION_HIST,
            vectors_config=VectorParams(size=vector_size, distance=Distance.COSINE),
        )
        logger.info(f"Created collection: {QDRANT_COLLECTION_HIST}")
    
    # Crear colección vigente
    if QDRANT_COLLECTION_VIG not in collection_names:
        client.create_collection(
            collection_name=QDRANT_COLLECTION_VIG,
            vectors_config=VectorParams(size=vector_size, distance=Distance.COSINE),
        )
        logger.info(f"Created collection: {QDRANT_COLLECTION_VIG}")
    
    # Crear colección legacy si no existe (para compatibilidad)
    if QDRANT_COLLECTION_NAME not in collection_names:
        client.create_collection(
            collection_name=QDRANT_COLLECTION_NAME,
            vectors_config=VectorParams(size=vector_size, distance=Distance.COSINE),
        )
        logger.info(f"Created legacy collection: {QDRANT_COLLECTION_NAME}")


def ensure_collection_exists():
    """Legacy function for backward compatibility."""
    ensure_collections_exist()


def hash_to_uuid(hash_string: str) -> str:
    """
    Convert a hash string (SHA256) to a valid UUID format for Qdrant.
    
    Qdrant requires IDs to be either integers or UUIDs. This function
    converts our SHA256 hashes (64 hex chars) to valid UUID format.
    
    Args:
        hash_string: SHA256 hash string (64 hex chars)
        
    Returns:
        UUID formatted string (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
    """
    # Use first 32 hex chars of hash to create UUID
    uuid_str = hash_string[:32]
    # Format as standard UUID
    return f"{uuid_str[:8]}-{uuid_str[8:12]}-{uuid_str[12:16]}-{uuid_str[16:20]}-{uuid_str[20:32]}"


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
        logger.error(f"Error generating embeddings: {e}")
        # Return a zero vector as fallback
        return [0.0] * 768


def upsert_point(
    collection: str,
    point_id: str,
    vector: List[float],
    payload: Dict[str, Any]
):
    """
    Upsert un punto en una colección de Qdrant con ID determinista.
    
    Args:
        collection: Nombre de la colección
        point_id: ID determinista del punto (hash string like id_fragmento)
        vector: Vector de embeddings
        payload: Metadata del punto (NO incluir texto completo)
    """
    ensure_collections_exist()
    
    client = get_qdrant_client()
    
    # Convert hash string to UUID format for Qdrant
    # Qdrant expects either int or UUID, not arbitrary strings
    uuid_id = hash_to_uuid(point_id)
    
    # Store original ID in payload for reference
    payload_with_id = {**payload, '_original_id': point_id}
    
    point = PointStruct(
        id=uuid_id,
        vector=vector,
        payload=payload_with_id
    )
    
    client.upsert(
        collection_name=collection,
        points=[point]
    )


def search_vigente(
    query_vector: List[float],
    limit: int = 5
) -> List[Any]:
    """
    Busca en la colección de legislación vigente.
    
    Args:
        query_vector: Vector de búsqueda
        limit: Número de resultados
        
    Returns:
        Lista de resultados
    """
    client = get_qdrant_client()
    
    try:
        search_result = client.search(
            collection_name=QDRANT_COLLECTION_VIG,
            query_vector=query_vector,
            limit=limit
        )
        return search_result
    except Exception as e:
        logger.error(f"Error searching vigente collection: {e}")
        return []


def search_historico_as_of(
    query_vector: List[float],
    as_of_date: date,
    limit: int = 5
) -> List[Any]:
    """
    Busca en la colección histórica filtrando por fecha.
    
    Filtro: vigencia_desde <= as_of_date AND 
            (vigencia_hasta IS NULL OR vigencia_hasta >= as_of_date)
    
    Args:
        query_vector: Vector de búsqueda
        as_of_date: Fecha de referencia
        limit: Número de resultados
        
    Returns:
        Lista de resultados
    """
    client = get_qdrant_client()
    
    try:
        # Convertir fecha a timestamp para filtrado
        as_of_timestamp = as_of_date.isoformat()
        
        # Crear filtros
        filter_conditions = Filter(
            must=[
                FieldCondition(
                    key="vigencia_desde",
                    range=Range(lte=as_of_timestamp)
                )
            ],
            should=[
                # vigencia_hasta IS NULL (vigente indefinidamente)
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
            query_vector=query_vector,
            query_filter=filter_conditions,
            limit=limit
        )
        return search_result
    except Exception as e:
        logger.error(f"Error searching historico collection: {e}")
        return []


def store_in_qdrant(embedding, text, metadata):
    """
    Store embedding and metadata in Qdrant (legacy function).
    
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
    Search for similar documents in Qdrant (legacy function).
    
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
