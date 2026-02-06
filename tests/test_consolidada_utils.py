"""
Unit tests for BOE Consolidada utilities.
"""
import unittest
from datetime import date, datetime
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
        # Formula: target_tokens * 4 chars/token * 1.5 buffer * 2 for overlap
        MAX_CHUNK_SIZE = 50 * 4 * 1.5 * 2  # = 600 chars
        
        for chunk in chunks:
            self.assertLess(len(chunk['text']), MAX_CHUNK_SIZE)


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
        """Test date parsing with multiple formats."""
        from utils.boe_consolidada_client import BOEConsolidadaClient
        
        client = BOEConsolidadaClient()
        
        # Test YYYYMMDD format (BOE format)
        parsed = client._parse_date('20240115')
        self.assertEqual(parsed, date(2024, 1, 15))
        
        # Test YYYY-MM-DD format (ISO)
        parsed = client._parse_date('2024-01-15')
        self.assertEqual(parsed, date(2024, 1, 15))
        
        # Test None
        parsed = client._parse_date(None)
        self.assertIsNone(parsed)
        
        # Test invalid date
        parsed = client._parse_date('invalid')
        self.assertIsNone(parsed)
    
    def test_parse_datetime(self):
        """Test datetime parsing with multiple formats."""
        from utils.boe_consolidada_client import BOEConsolidadaClient
        from datetime import datetime
        
        client = BOEConsolidadaClient()
        
        # Test YYYYMMDDTHHMMSSZ format (BOE format)
        parsed = client._parse_datetime('20240115T120000Z')
        self.assertEqual(parsed, datetime(2024, 1, 15, 12, 0, 0))
        
        # Test ISO format
        parsed = client._parse_datetime('2024-01-15T12:00:00')
        self.assertEqual(parsed, datetime(2024, 1, 15, 12, 0, 0))
        
        # Test None
        parsed = client._parse_datetime(None)
        self.assertIsNone(parsed)
        
        # Test invalid datetime
        parsed = client._parse_datetime('invalid')
        self.assertIsNone(parsed)
    
    def test_parse_date_formats(self):
        """Test date parsing with all BOE formats."""
        from utils.boe_consolidada_client import BOEConsolidadaClient
        
        client = BOEConsolidadaClient()
        
        # Test YYYYMMDD format (BOE format)
        parsed = client._parse_date('20240115')
        self.assertEqual(parsed, date(2024, 1, 15))
        
        # Test another YYYYMMDD
        parsed = client._parse_date('20181206')
        self.assertEqual(parsed, date(2018, 12, 6))
        
        # Test YYYY-MM-DD format (ISO fallback)
        parsed = client._parse_date('2024-01-15')
        self.assertEqual(parsed, date(2024, 1, 15))
    
    def test_parse_datetime_formats(self):
        """Test datetime parsing with all BOE formats."""
        from utils.boe_consolidada_client import BOEConsolidadaClient
        from datetime import datetime
        
        client = BOEConsolidadaClient()
        
        # Test YYYYMMDDTHHMMSSZ format (BOE format)
        parsed = client._parse_datetime('20240115T120000Z')
        self.assertEqual(parsed, datetime(2024, 1, 15, 12, 0, 0))
        
        # Test another BOE datetime
        parsed = client._parse_datetime('20181206T093000Z')
        self.assertEqual(parsed, datetime(2018, 12, 6, 9, 30, 0))
    
    def test_parse_list_normas_real_shape(self):
        """Test parsing list_normas with real API JSON structure."""
        from utils.boe_consolidada_client import BOEConsolidadaClient
        
        client = BOEConsolidadaClient()
        
        # Real API response structure
        real_response = {
            "status": {
                "code": "200",
                "text": "OK"
            },
            "data": [
                {
                    "identificador": "BOE-A-2018-16673",
                    "titulo": "Ley Orgánica 3/2018, de 5 de diciembre",
                    "fecha_actualizacion": "20240115T120000Z",
                    "fecha_publicacion": "20181206",
                    "fecha_disposicion": "20181205",
                    "rango": {
                        "codigo": "050",
                        "texto": "Ley Orgánica"
                    },
                    "departamento": {
                        "codigo": "M123",
                        "texto": "Ministerio de la Presidencia"
                    },
                    "ambito": {
                        "codigo": "E",
                        "texto": "Estatal"
                    },
                    "url_html_consolidada": "https://www.boe.es/buscar/act.php?id=BOE-A-2018-16673",
                    "url_eli": "https://www.boe.es/eli/es/lo/2018/12/05/3/con"
                }
            ]
        }
        
        normas = client._parse_normas_json(real_response)
        
        self.assertEqual(len(normas), 1)
        norma = normas[0]
        self.assertEqual(norma['id_norma'], "BOE-A-2018-16673")
        self.assertIsNotNone(norma['titulo'])
        self.assertEqual(norma['rango'], "Ley Orgánica")
        self.assertEqual(norma['departamento'], "Ministerio de la Presidencia")
        self.assertEqual(norma['ambito'], "Estatal")
        self.assertEqual(norma['fecha_publicacion'], date(2018, 12, 6))
        self.assertEqual(norma['fecha_actualizacion_api'], datetime(2024, 1, 15, 12, 0, 0))
    
    def test_parse_indice_real_shape(self):
        """Test parsing get_indice with real API JSON structure."""
        from utils.boe_consolidada_client import BOEConsolidadaClient
        
        client = BOEConsolidadaClient()
        
        # Test with data as single object
        real_response_obj = {
            "status": {"code": "200", "text": "OK"},
            "data": {
                "identificador": "BOE-A-2018-16673",
                "titulo": "Ley Orgánica 3/2018",
                "bloques": [
                    {
                        "identificador": "TITULO_I",
                        "tipo": "Título",
                        "titulo": "Título I. Disposiciones generales",
                        "fecha_actualizacion": "20240115T120000Z",
                        "url": "https://www.boe.es/..."
                    },
                    {
                        "identificador": "ART_1",
                        "tipo": "Artículo",
                        "titulo": "Artículo 1. Objeto",
                        "fecha_actualizacion": "20240115T120000Z"
                    }
                ]
            }
        }
        
        result = client._parse_indice_json(real_response_obj)
        
        self.assertEqual(result['id_norma'], "BOE-A-2018-16673")
        self.assertEqual(len(result['bloques']), 2)
        self.assertEqual(result['bloques'][0]['id_bloque'], "TITULO_I")
        self.assertEqual(result['bloques'][1]['id_bloque'], "ART_1")
        
        # Test with data as array with single object
        real_response_array = {
            "status": {"code": "200", "text": "OK"},
            "data": [{
                "identificador": "BOE-A-2018-16673",
                "bloques": [
                    {"identificador": "ART_2", "tipo": "Artículo", "titulo": "Artículo 2"}
                ]
            }]
        }
        
        result = client._parse_indice_json(real_response_array)
        
        self.assertEqual(len(result['bloques']), 1)
        self.assertEqual(result['bloques'][0]['id_bloque'], "ART_2")
    
    def test_parse_bloque_real_shape(self):
        """Test parsing get_bloque with real API JSON structure."""
        from utils.boe_consolidada_client import BOEConsolidadaClient
        
        client = BOEConsolidadaClient()
        
        # Test with data as single object
        real_response = {
            "status": {"code": "200", "text": "OK"},
            "data": {
                "id_norma": "BOE-A-2018-16673",
                "identificador_bloque": "ART_5",
                "tipo": "Artículo",
                "titulo": "Artículo 5. Definiciones",
                "versiones": [
                    {
                        "id_norma_modificadora": "BOE-A-2018-16673",
                        "fecha_vigencia": "20181207",
                        "fecha_publicacion": "20181206",
                        "html": "<p>Contenido del artículo...</p>"
                    },
                    {
                        "id_norma_modificadora": "BOE-A-2020-12345",
                        "fecha_vigencia_desde": "20200101",
                        "html": "<p>Contenido modificado...</p>"
                    }
                ]
            }
        }
        
        result = client._parse_bloque_json(real_response)
        
        self.assertEqual(result['id_norma'], "BOE-A-2018-16673")
        self.assertEqual(result['id_bloque'], "ART_5")
        self.assertEqual(len(result['versiones']), 2)
        self.assertEqual(result['versiones'][0]['id_norma_modificadora'], "BOE-A-2018-16673")
        self.assertEqual(result['versiones'][0]['fecha_vigencia_desde'], date(2018, 12, 7))
        self.assertIsNotNone(result['versiones'][0]['html'])
        self.assertEqual(result['versiones'][1]['fecha_vigencia_desde'], date(2020, 1, 1))
    
    def test_missing_ids_are_skipped(self):
        """Test that normas/bloques without IDs are skipped gracefully."""
        from utils.boe_consolidada_client import BOEConsolidadaClient
        
        client = BOEConsolidadaClient()
        
        # Test normas without identificador
        response_normas = {
            "status": {"code": "200", "text": "OK"},
            "data": [
                {
                    "identificador": "BOE-A-2018-16673",
                    "titulo": "Valid norma",
                    "rango": {"texto": "Ley"}
                },
                {
                    # Missing identificador
                    "titulo": "Invalid norma without ID",
                    "rango": {"texto": "Ley"}
                },
                {
                    "identificador": "BOE-A-2019-12345",
                    "titulo": "Another valid norma"
                }
            ]
        }
        
        normas = client._parse_normas_json(response_normas)
        
        # Should only return normas with valid IDs
        self.assertEqual(len(normas), 2)
        self.assertEqual(normas[0]['id_norma'], "BOE-A-2018-16673")
        self.assertEqual(normas[1]['id_norma'], "BOE-A-2019-12345")
        
        # Test bloques without identificador
        response_indice = {
            "status": {"code": "200", "text": "OK"},
            "data": {
                "identificador": "BOE-A-2018-16673",
                "titulo": "Test norma",
                "bloques": [
                    {
                        "identificador": "ART_1",
                        "tipo": "Artículo",
                        "titulo": "Valid bloque"
                    },
                    {
                        # Missing identificador
                        "tipo": "Artículo",
                        "titulo": "Invalid bloque without ID"
                    },
                    {
                        "identificador": "ART_2",
                        "tipo": "Artículo",
                        "titulo": "Another valid bloque"
                    }
                ]
            }
        }
        
        result = client._parse_indice_json(response_indice)
        
        # Should only return bloques with valid IDs
        self.assertEqual(len(result['bloques']), 2)
        self.assertEqual(result['bloques'][0]['id_bloque'], "ART_1")
        self.assertEqual(result['bloques'][1]['id_bloque'], "ART_2")
        
        # Test versiones without html
        response_bloque = {
            "status": {"code": "200", "text": "OK"},
            "data": {
                "id_norma": "BOE-A-2018-16673",
                "identificador_bloque": "ART_1",
                "versiones": [
                    {
                        "id_norma_modificadora": "BOE-A-2018-16673",
                        "fecha_vigencia": "20181207",
                        "html": "<p>Valid version with HTML</p>"
                    },
                    {
                        # Missing html
                        "id_norma_modificadora": "BOE-A-2019-12345",
                        "fecha_vigencia": "20190101"
                    },
                    {
                        "id_norma_modificadora": "BOE-A-2020-12345",
                        "fecha_vigencia": "20200101",
                        "html": "<p>Another valid version</p>"
                    }
                ]
            }
        }
        
        result = client._parse_bloque_json(response_bloque)
        
        # Should only return versions with HTML content
        self.assertEqual(len(result['versiones']), 2)
        self.assertEqual(result['versiones'][0]['id_norma_modificadora'], "BOE-A-2018-16673")
        self.assertEqual(result['versiones'][1]['id_norma_modificadora'], "BOE-A-2020-12345")



if __name__ == '__main__':
    # Run tests
    unittest.main()
