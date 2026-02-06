"""
Idempotency utilities using deterministic hashing.
"""
import hashlib
from datetime import date
from typing import Optional


def calculate_hash(content: str) -> str:
    """
    Calculate SHA256 hash of content for idempotency checks.
    
    Args:
        content: String content to hash
        
    Returns:
        SHA256 hex digest
    """
    if content is None:
        content = ""
    
    return hashlib.sha256(content.encode('utf-8')).hexdigest()


def generate_id_version(
    id_norma: str,
    id_bloque: str,
    fecha_vigencia_desde: date,
    id_norma_modificadora: Optional[str],
    hash_html: str
) -> str:
    """
    Genera un ID determinista para una versión de un bloque.
    
    Formula: SHA256(id_norma + id_bloque + fecha_vigencia_desde + 
                    id_norma_modificadora + hash_html)
    
    Args:
        id_norma: ID de la norma
        id_bloque: ID del bloque
        fecha_vigencia_desde: Fecha de inicio de vigencia
        id_norma_modificadora: ID de la norma que modifica (puede ser None)
        hash_html: Hash del HTML de la versión
        
    Returns:
        ID determinista (SHA256 hex digest)
    """
    components = [
        id_norma or '',
        id_bloque or '',
        fecha_vigencia_desde.isoformat() if fecha_vigencia_desde else '',
        id_norma_modificadora or '',
        hash_html or ''
    ]
    
    combined = '|'.join(components)
    return hashlib.sha256(combined.encode('utf-8')).hexdigest()


def generate_id_fragmento(
    id_version: str,
    ordinal: int,
    hash_texto: str
) -> str:
    """
    Genera un ID determinista para un fragmento.
    
    Formula: SHA256(id_version + ordinal + hash_texto)
    
    Args:
        id_version: ID de la versión a la que pertenece
        ordinal: Número ordinal del fragmento dentro de la versión
        hash_texto: Hash del texto del fragmento
        
    Returns:
        ID determinista (SHA256 hex digest)
    """
    components = [
        id_version or '',
        str(ordinal),
        hash_texto or ''
    ]
    
    combined = '|'.join(components)
    return hashlib.sha256(combined.encode('utf-8')).hexdigest()


def check_document_exists(cursor, boe_id, content_hash):
    """
    Check if a document with the same boe_id and content_hash exists (legacy).
    
    Args:
        cursor: Database cursor
        boe_id: BOE document ID
        content_hash: SHA256 hash of content
        
    Returns:
        Boolean indicating if document exists with same hash
    """
    cursor.execute("""
        SELECT id FROM boe_documents 
        WHERE boe_id = %s AND content_hash = %s
    """, (boe_id, content_hash))
    
    return cursor.fetchone() is not None


def check_version_exists(cursor, id_version: str) -> bool:
    """
    Verifica si una versión ya existe en la base de datos.
    
    Args:
        cursor: Database cursor
        id_version: ID determinista de la versión
        
    Returns:
        True si existe, False en caso contrario
    """
    cursor.execute("""
        SELECT id_version FROM boe_version 
        WHERE id_version = %s
    """, (id_version,))
    
    return cursor.fetchone() is not None


def check_fragmento_exists(cursor, id_fragmento: str) -> bool:
    """
    Verifica si un fragmento ya existe en la base de datos.
    
    Args:
        cursor: Database cursor
        id_fragmento: ID determinista del fragmento
        
    Returns:
        True si existe, False en caso contrario
    """
    cursor.execute("""
        SELECT id_fragmento FROM boe_fragmento 
        WHERE id_fragmento = %s
    """, (id_fragmento,))
    
    return cursor.fetchone() is not None
