"""
Text processing utilities for chunking documents and HTML conversion.
"""
import re
from typing import List, Dict
from bs4 import BeautifulSoup
import logging

logger = logging.getLogger(__name__)


def html_to_text_structured(html: str) -> str:
    """
    Convierte HTML a texto estructurado preservando:
    - Artículos (Artículo X)
    - Listas numeradas/viñetas
    - Tablas (como Markdown simple)
    - Ignora imágenes base64
    
    Args:
        html: HTML string del contenido del bloque
        
    Returns:
        Texto normalizado con estructura preservada
    """
    if not html:
        return ""
    
    try:
        soup = BeautifulSoup(html, 'html.parser')
        
        # Remover scripts y styles
        for script in soup(["script", "style"]):
            script.decompose()
        
        # Remover imágenes base64 (suelen ser decorativas)
        for img in soup.find_all('img'):
            src = img.get('src', '')
            if 'base64' in src or 'data:image' in src:
                img.decompose()
        
        # Procesar elementos especiales
        _process_articles(soup)
        _process_tables(soup)
        _process_lists(soup)
        
        # Extraer texto
        text = soup.get_text(separator='\n')
        
        # Normalizar espacios en blanco
        lines = [line.strip() for line in text.splitlines()]
        lines = [line for line in lines if line]
        text = '\n\n'.join(lines)
        
        return text
    
    except Exception as e:
        logger.error(f"Error converting HTML to text: {e}")
        # Fallback: simple text extraction
        soup = BeautifulSoup(html, 'html.parser')
        return soup.get_text(separator=' ')


def _process_articles(soup):
    """Marca artículos para preservar estructura."""
    # Buscar patrones como "Artículo X", "Art. X"
    article_pattern = re.compile(r'(Artículo|Art\.)\s+(\d+[a-z]?)', re.IGNORECASE)
    
    for elem in soup.find_all(text=article_pattern):
        if elem.parent:
            elem.parent.string = f"\n\n{elem}\n"


def _process_tables(soup):
    """Convierte tablas HTML a Markdown simple."""
    for table in soup.find_all('table'):
        markdown_table = []
        
        # Procesar filas
        rows = table.find_all('tr')
        for i, row in enumerate(rows):
            cells = row.find_all(['th', 'td'])
            if cells:
                row_text = ' | '.join(cell.get_text(strip=True) for cell in cells)
                markdown_table.append(f"| {row_text} |")
                
                # Añadir separador después de headers
                if i == 0 and row.find_all('th'):
                    separator = '|' + '---|' * len(cells)
                    markdown_table.append(separator)
        
        if markdown_table:
            table.replace_with('\n' + '\n'.join(markdown_table) + '\n')


def _process_lists(soup):
    """Procesa listas numeradas y con viñetas."""
    # Listas ordenadas
    for ol in soup.find_all('ol'):
        items = ol.find_all('li', recursive=False)
        list_text = []
        for i, item in enumerate(items, 1):
            list_text.append(f"{i}. {item.get_text(strip=True)}")
        if list_text:
            ol.replace_with('\n' + '\n'.join(list_text) + '\n')
    
    # Listas no ordenadas
    for ul in soup.find_all('ul'):
        items = ul.find_all('li', recursive=False)
        list_text = []
        for item in items:
            list_text.append(f"• {item.get_text(strip=True)}")
        if list_text:
            ul.replace_with('\n' + '\n'.join(list_text) + '\n')


def chunk_text_by_article_or_size(
    text: str, 
    target_tokens: int = 600,
    overlap_tokens: int = 50
) -> List[Dict[str, any]]:
    """
    Divide texto en chunks inteligentes:
    - Preferiblemente por artículos
    - Si un artículo es muy largo, lo divide en sub-chunks
    - Target: 300-900 tokens aprox (usando estimación de 4 chars = 1 token)
    
    Args:
        text: Texto normalizado a dividir
        target_tokens: Tokens objetivo por chunk (aprox 600)
        overlap_tokens: Overlap entre chunks (aprox 50)
        
    Returns:
        Lista de dicts con {text, articulo_ref, ordinal}
    """
    if not text:
        return []
    
    # Estimación: 4 caracteres ≈ 1 token
    target_chars = target_tokens * 4
    overlap_chars = overlap_tokens * 4
    
    chunks = []
    
    # Intentar dividir por artículos
    article_pattern = re.compile(r'\n\n(Artículo\s+\d+[a-z]?\.?\s+[^\n]+)', re.IGNORECASE)
    articles = article_pattern.split(text)
    
    if len(articles) > 1:
        # Hay artículos identificados
        current_chunk = ""
        current_article_ref = None
        
        for i, segment in enumerate(articles):
            if article_pattern.match(segment):
                # Es un encabezado de artículo
                if current_chunk and len(current_chunk) > 100:
                    chunks.append({
                        'text': current_chunk.strip(),
                        'articulo_ref': current_article_ref,
                        'ordinal': len(chunks)
                    })
                
                current_article_ref = segment.split('\n')[0].strip()
                current_chunk = segment
            else:
                # Es contenido
                current_chunk += segment
                
                # Si el chunk es muy largo, dividirlo
                if len(current_chunk) > target_chars * 1.5:
                    sub_chunks = _split_by_size(current_chunk, target_chars, overlap_chars)
                    for sub_chunk in sub_chunks:
                        chunks.append({
                            'text': sub_chunk.strip(),
                            'articulo_ref': current_article_ref,
                            'ordinal': len(chunks)
                        })
                    current_chunk = ""
        
        # Añadir último chunk
        if current_chunk and len(current_chunk) > 100:
            chunks.append({
                'text': current_chunk.strip(),
                'articulo_ref': current_article_ref,
                'ordinal': len(chunks)
            })
    else:
        # No hay artículos, dividir por tamaño
        text_chunks = _split_by_size(text, target_chars, overlap_chars)
        chunks = [
            {
                'text': chunk.strip(),
                'articulo_ref': None,
                'ordinal': i
            }
            for i, chunk in enumerate(text_chunks)
        ]
    
    return chunks


def _split_by_size(text: str, target_size: int, overlap: int) -> List[str]:
    """Divide texto por tamaño con overlap."""
    chunks = []
    start = 0
    text_length = len(text)
    
    while start < text_length:
        end = start + target_size
        
        # Intentar romper en límite de oración
        if end < text_length:
            sentence_ends = ['. ', '.\n', '.\t', '? ', '!\n', '! ']
            best_break = end
            
            # Buscar hacia atrás un buen punto de ruptura
            search_start = max(start, end - 200)
            for i in range(end, search_start, -1):
                if i + 2 <= text_length:
                    if text[i:i+2] in sentence_ends:
                        best_break = i + 2
                        break
            
            end = best_break
        
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        
        # Mover inicio con overlap
        start = end - overlap
        if start <= 0:
            start = end
    
    return chunks


def chunk_text(text, chunk_size=1000, overlap=200):
    """
    Split text into overlapping chunks (legacy function for compatibility).
    
    Args:
        text: Text to chunk
        chunk_size: Maximum size of each chunk in characters
        overlap: Number of characters to overlap between chunks
        
    Returns:
        List of text chunks
    """
    if not text:
        return []
    
    return _split_by_size(text, chunk_size, overlap)


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
