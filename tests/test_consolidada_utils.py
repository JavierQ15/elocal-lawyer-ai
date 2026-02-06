"""
Unit tests for BOE Consolidada utilities.
"""
import unittest
from datetime import date
import sys
import os

# Add airflow dags to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'airflow', 'dags'))

from utils.idempotency import generate_id_version, generate_id_fragmento, calculate_hash
from utils.text_processing import html_to_text_structured, chunk_text_by_article_or_size


class TestIdempotency(unittest.TestCase):
    """Test deterministic ID generation."""
    
    def test_generate_id_version_deterministic(self):
        """Test that same inputs always generate same id_version."""
        id_v1 = generate_id_version(
            id_norma="BOE-A-2024-001",
            id_bloque="ART_1",
            fecha_vigencia_desde=date(2024, 1, 1),
            id_norma_modificadora=None,
            hash_html="abc123"
        )
        
        id_v2 = generate_id_version(
            id_norma="BOE-A-2024-001",
            id_bloque="ART_1",
            fecha_vigencia_desde=date(2024, 1, 1),
            id_norma_modificadora=None,
            hash_html="abc123"
        )
        
        self.assertEqual(id_v1, id_v2)
        self.assertEqual(len(id_v1), 64)  # SHA256 hex digest
    
    def test_generate_id_version_different_inputs(self):
        """Test that different inputs generate different ids."""
        id_v1 = generate_id_version(
            id_norma="BOE-A-2024-001",
            id_bloque="ART_1",
            fecha_vigencia_desde=date(2024, 1, 1),
            id_norma_modificadora=None,
            hash_html="abc123"
        )
        
        id_v2 = generate_id_version(
            id_norma="BOE-A-2024-001",
            id_bloque="ART_2",  # Different bloque
            fecha_vigencia_desde=date(2024, 1, 1),
            id_norma_modificadora=None,
            hash_html="abc123"
        )
        
        self.assertNotEqual(id_v1, id_v2)
    
    def test_generate_id_fragmento_deterministic(self):
        """Test that same inputs always generate same id_fragmento."""
        id_f1 = generate_id_fragmento(
            id_version="version123",
            ordinal=0,
            hash_texto="text_hash"
        )
        
        id_f2 = generate_id_fragmento(
            id_version="version123",
            ordinal=0,
            hash_texto="text_hash"
        )
        
        self.assertEqual(id_f1, id_f2)
        self.assertEqual(len(id_f1), 64)
    
    def test_calculate_hash(self):
        """Test SHA256 hash calculation."""
        hash1 = calculate_hash("test content")
        hash2 = calculate_hash("test content")
        hash3 = calculate_hash("different content")
        
        self.assertEqual(hash1, hash2)
        self.assertNotEqual(hash1, hash3)
        self.assertEqual(len(hash1), 64)


class TestTextProcessing(unittest.TestCase):
    """Test HTML to text conversion and chunking."""
    
    def test_html_to_text_simple(self):
        """Test simple HTML to text conversion."""
        html = "<p>Este es un párrafo.</p>"
        text = html_to_text_structured(html)
        
        self.assertIn("Este es un párrafo", text)
        self.assertNotIn("<p>", text)
        self.assertNotIn("</p>", text)
    
    def test_html_to_text_articles(self):
        """Test that articles are preserved."""
        html = "<h2>Artículo 5. Definiciones</h2><p>Contenido del artículo.</p>"
        text = html_to_text_structured(html)
        
        self.assertIn("Artículo 5", text)
        self.assertIn("Definiciones", text)
        self.assertIn("Contenido del artículo", text)
    
    def test_html_to_text_tables(self):
        """Test that tables are converted to Markdown."""
        html = """
        <table>
            <tr><th>Columna 1</th><th>Columna 2</th></tr>
            <tr><td>Valor 1</td><td>Valor 2</td></tr>
        </table>
        """
        text = html_to_text_structured(html)
        
        self.assertIn("Columna 1", text)
        self.assertIn("Columna 2", text)
        self.assertIn("|", text)  # Markdown table format
    
    def test_html_to_text_removes_scripts(self):
        """Test that scripts and styles are removed."""
        html = "<script>alert('test')</script><p>Content</p><style>.test{}</style>"
        text = html_to_text_structured(html)
        
        self.assertNotIn("alert", text)
        self.assertNotIn("script", text)
        self.assertNotIn("style", text)
        self.assertIn("Content", text)
    
    def test_chunk_text_by_article(self):
        """Test chunking by articles."""
        text = """
Artículo 1. Primer artículo

Este es el contenido del primer artículo.

Artículo 2. Segundo artículo

Este es el contenido del segundo artículo.
        """
        
        chunks = chunk_text_by_article_or_size(text, target_tokens=100)
        
        self.assertGreater(len(chunks), 0)
        
        # Check that chunks have ordinals
        ordinals = [c['ordinal'] for c in chunks]
        self.assertEqual(ordinals, list(range(len(chunks))))
        
        # Check that article references are captured
        article_refs = [c.get('articulo_ref') for c in chunks if c.get('articulo_ref')]
        self.assertGreater(len(article_refs), 0)
    
    def test_chunk_text_by_size(self):
        """Test chunking by size when no articles."""
        text = "Este es un texto largo " * 100  # Repeat to make it long
        
        chunks = chunk_text_by_article_or_size(text, target_tokens=50)
        
        self.assertGreater(len(chunks), 1)
        
        # All chunks should be roughly the target size
        for chunk in chunks:
            # Approximate: 4 chars = 1 token, so 50 tokens ~ 200 chars
            self.assertLess(len(chunk['text']), 800)  # 200 * 1.5 * 2 for overlap


class TestBOEConsolidadaClient(unittest.TestCase):
    """Test BOE Consolidada API client (mock tests)."""
    
    def test_client_initialization(self):
        """Test that client can be initialized."""
        from utils.boe_consolidada_client import BOEConsolidadaClient
        
        client = BOEConsolidadaClient()
        self.assertIsNotNone(client)
        self.assertTrue(hasattr(client, 'list_normas'))
        self.assertTrue(hasattr(client, 'get_indice'))
        self.assertTrue(hasattr(client, 'get_bloque'))
    
    def test_parse_date(self):
        """Test date parsing."""
        from utils.boe_consolidada_client import BOEConsolidadaClient
        
        client = BOEConsolidadaClient()
        
        # Test valid date
        parsed = client._parse_date('2024-01-15')
        self.assertEqual(parsed, date(2024, 1, 15))
        
        # Test None
        parsed = client._parse_date(None)
        self.assertIsNone(parsed)
        
        # Test invalid date
        parsed = client._parse_date('invalid')
        self.assertIsNone(parsed)


if __name__ == '__main__':
    # Run tests
    unittest.main()
