"""
Text processing utilities for chunking documents.
"""


def chunk_text(text, chunk_size=1000, overlap=200):
    """
    Split text into overlapping chunks.
    
    Args:
        text: Text to chunk
        chunk_size: Maximum size of each chunk in characters
        overlap: Number of characters to overlap between chunks
        
    Returns:
        List of text chunks
    """
    if not text:
        return []
    
    chunks = []
    start = 0
    text_length = len(text)
    
    while start < text_length:
        end = start + chunk_size
        
        # If this is not the last chunk, try to break at a sentence boundary
        if end < text_length:
            # Look for sentence endings near the chunk boundary
            sentence_ends = ['. ', '.\n', '? ', '!\n']
            best_break = end
            
            # Search backwards from end for a good break point
            search_start = max(start, end - 100)
            for i in range(end, search_start, -1):
                if text[i:i+2] in sentence_ends:
                    best_break = i + 2
                    break
            
            end = best_break
        
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        
        # Move start forward, accounting for overlap
        start = end - overlap
        if start < 0:
            start = 0
    
    return chunks


def clean_text(text):
    """
    Clean and normalize text.
    
    Args:
        text: Text to clean
        
    Returns:
        Cleaned text
    """
    if not text:
        return ""
    
    # Remove excessive whitespace
    text = ' '.join(text.split())
    
    # Remove special characters that might cause issues
    # (keeping Spanish characters)
    
    return text.strip()
