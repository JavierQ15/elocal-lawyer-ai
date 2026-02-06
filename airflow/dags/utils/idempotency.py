"""
Idempotency utilities using content hashing.
"""
import hashlib


def calculate_hash(content):
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


def check_document_exists(cursor, boe_id, content_hash):
    """
    Check if a document with the same boe_id and content_hash exists.
    
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
