#!/usr/bin/env python3
"""
Smoke test for BOE Consolidada RAG system.
Tests the complete flow:
1. Insert 1 mock norma with 2 bloques
2. Generate embeddings
3. Query the system (vigente and historico modes)
"""
import sys
import os
import psycopg2
from psycopg2.extras import Json
import requests
import time
from datetime import date, datetime, timedelta

# Database connection
DB_HOST = os.getenv('POSTGRES_HOST', 'localhost')
DB_PORT = os.getenv('POSTGRES_PORT', '5432')
DB_NAME = os.getenv('POSTGRES_DB', 'boe_legislation')
DB_USER = os.getenv('POSTGRES_USER', 'postgres')
DB_PASS = os.getenv('POSTGRES_PASSWORD', 'postgres')

# API endpoints
OLLAMA_URL = f"http://{os.getenv('OLLAMA_HOST', 'localhost')}:{os.getenv('OLLAMA_PORT', '11434')}"
QDRANT_URL = f"http://{os.getenv('QDRANT_HOST', 'localhost')}:{os.getenv('QDRANT_PORT', '6333')}"
RAG_API_URL = f"http://{os.getenv('RAG_API_HOST', 'localhost')}:{os.getenv('RAG_API_PORT', '8000')}"

# Test data
TEST_NORMA_ID = 'BOE-A-2024-TEST-001'
TEST_BLOQUE_1_ID = 'ART_1'
TEST_BLOQUE_2_ID = 'ART_2'


def print_step(step_num, description):
    """Print a test step."""
    print(f"\n{'='*60}")
    print(f"STEP {step_num}: {description}")
    print(f"{'='*60}")


def check_services():
    """Check that all required services are running."""
    print_step(1, "Checking services")
    
    services_ok = True
    
    # Check Postgres
    try:
        conn = psycopg2.connect(
            host=DB_HOST,
            port=DB_PORT,
            dbname=DB_NAME,
            user=DB_USER,
            password=DB_PASS
        )
        conn.close()
        print("✓ PostgreSQL is running")
    except Exception as e:
        print(f"✗ PostgreSQL is NOT running: {e}")
        services_ok = False
    
    # Check Ollama
    try:
        response = requests.get(f"{OLLAMA_URL}/api/tags", timeout=5)
        response.raise_for_status()
        print("✓ Ollama is running")
    except Exception as e:
        print(f"✗ Ollama is NOT running: {e}")
        services_ok = False
    
    # Check Qdrant
    try:
        response = requests.get(f"{QDRANT_URL}/collections", timeout=5)
        response.raise_for_status()
        print("✓ Qdrant is running")
    except Exception as e:
        print(f"✗ Qdrant is NOT running: {e}")
        services_ok = False
    
    # Check RAG API
    try:
        response = requests.get(f"{RAG_API_URL}/health", timeout=5)
        response.raise_for_status()
        print("✓ RAG API is running")
    except Exception as e:
        print(f"✗ RAG API is NOT running: {e}")
        services_ok = False
    
    if not services_ok:
        print("\n❌ Some services are not running. Please start them with 'docker compose up'")
        sys.exit(1)
    
    print("\n✅ All services are running")


def insert_test_data():
    """Insert test norma with 2 bloques."""
    print_step(2, "Inserting test data")
    
    conn = psycopg2.connect(
        host=DB_HOST,
        port=DB_PORT,
        dbname=DB_NAME,
        user=DB_USER,
        password=DB_PASS
    )
    cursor = conn.cursor()
    
    # Insert norma
    print(f"Inserting test norma: {TEST_NORMA_ID}")
    cursor.execute("""
        INSERT INTO boe_norma (
            id_norma, titulo, rango, departamento, ambito,
            fecha_publicacion, fecha_disposicion, url_html_consolidada,
            fecha_actualizacion_api, metadata_jsonb
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (id_norma) DO UPDATE SET
            titulo = EXCLUDED.titulo,
            last_seen_at = CURRENT_TIMESTAMP
    """, (
        TEST_NORMA_ID,
        'Ley de Prueba del Sistema RAG',
        'Ley',
        'Ministerio de Pruebas',
        'Estatal',
        date(2024, 1, 1),
        date(2024, 1, 1),
        'https://www.boe.es/test',
        datetime.now(),
        Json({'test': True})
    ))
    
    # Insert bloque 1
    print(f"Inserting bloque 1: {TEST_BLOQUE_1_ID}")
    cursor.execute("""
        INSERT INTO boe_bloque (
            id_norma, id_bloque, tipo, titulo_bloque,
            fecha_actualizacion_bloque, url_bloque
        ) VALUES (%s, %s, %s, %s, %s, %s)
        ON CONFLICT (id_norma, id_bloque) DO UPDATE SET
            titulo_bloque = EXCLUDED.titulo_bloque
    """, (
        TEST_NORMA_ID,
        TEST_BLOQUE_1_ID,
        'Artículo',
        'Artículo 1. Objeto',
        datetime.now(),
        'https://www.boe.es/test/art1'
    ))
    
    # Insert bloque 2
    print(f"Inserting bloque 2: {TEST_BLOQUE_2_ID}")
    cursor.execute("""
        INSERT INTO boe_bloque (
            id_norma, id_bloque, tipo, titulo_bloque,
            fecha_actualizacion_bloque, url_bloque
        ) VALUES (%s, %s, %s, %s, %s, %s)
        ON CONFLICT (id_norma, id_bloque) DO UPDATE SET
            titulo_bloque = EXCLUDED.titulo_bloque
    """, (
        TEST_NORMA_ID,
        TEST_BLOQUE_2_ID,
        'Artículo',
        'Artículo 2. Ámbito de aplicación',
        datetime.now(),
        'https://www.boe.es/test/art2'
    ))
    
    # Generate deterministic IDs and insert versions/fragmentos
    import hashlib
    
    # Version for bloque 1
    html_1 = "<p>Este artículo define el objeto de la ley de prueba.</p>"
    hash_html_1 = hashlib.sha256(html_1.encode('utf-8')).hexdigest()
    texto_1 = "Artículo 1. Objeto\n\nEste artículo define el objeto de la ley de prueba."
    hash_texto_1 = hashlib.sha256(texto_1.encode('utf-8')).hexdigest()
    
    id_version_1 = hashlib.sha256(
        f"{TEST_NORMA_ID}|{TEST_BLOQUE_1_ID}|2024-01-01||{hash_html_1}".encode('utf-8')
    ).hexdigest()
    
    print(f"Inserting version 1: {id_version_1[:16]}...")
    cursor.execute("""
        INSERT INTO boe_version (
            id_version, id_norma, id_bloque, fecha_vigencia_desde,
            hash_html, hash_texto
        ) VALUES (%s, %s, %s, %s, %s, %s)
        ON CONFLICT (id_version) DO NOTHING
    """, (
        id_version_1,
        TEST_NORMA_ID,
        TEST_BLOQUE_1_ID,
        date(2024, 1, 1),
        hash_html_1,
        hash_texto_1
    ))
    
    # Fragmento for version 1
    id_fragmento_1 = hashlib.sha256(
        f"{id_version_1}|0|{hash_texto_1}".encode('utf-8')
    ).hexdigest()
    
    print(f"Inserting fragmento 1: {id_fragmento_1[:16]}...")
    cursor.execute("""
        INSERT INTO boe_fragmento (
            id_fragmento, id_version, ordinal, texto_normalizado,
            hash_texto, articulo_ref
        ) VALUES (%s, %s, %s, %s, %s, %s)
        ON CONFLICT (id_fragmento) DO NOTHING
    """, (
        id_fragmento_1,
        id_version_1,
        0,
        texto_1,
        hash_texto_1,
        'Artículo 1'
    ))
    
    # Version for bloque 2
    html_2 = "<p>Esta ley se aplica en todo el territorio nacional.</p>"
    hash_html_2 = hashlib.sha256(html_2.encode('utf-8')).hexdigest()
    texto_2 = "Artículo 2. Ámbito de aplicación\n\nEsta ley se aplica en todo el territorio nacional."
    hash_texto_2 = hashlib.sha256(texto_2.encode('utf-8')).hexdigest()
    
    id_version_2 = hashlib.sha256(
        f"{TEST_NORMA_ID}|{TEST_BLOQUE_2_ID}|2024-01-01||{hash_html_2}".encode('utf-8')
    ).hexdigest()
    
    print(f"Inserting version 2: {id_version_2[:16]}...")
    cursor.execute("""
        INSERT INTO boe_version (
            id_version, id_norma, id_bloque, fecha_vigencia_desde,
            hash_html, hash_texto
        ) VALUES (%s, %s, %s, %s, %s, %s)
        ON CONFLICT (id_version) DO NOTHING
    """, (
        id_version_2,
        TEST_NORMA_ID,
        TEST_BLOQUE_2_ID,
        date(2024, 1, 1),
        hash_html_2,
        hash_texto_2
    ))
    
    # Fragmento for version 2
    id_fragmento_2 = hashlib.sha256(
        f"{id_version_2}|0|{hash_texto_2}".encode('utf-8')
    ).hexdigest()
    
    print(f"Inserting fragmento 2: {id_fragmento_2[:16]}...")
    cursor.execute("""
        INSERT INTO boe_fragmento (
            id_fragmento, id_version, ordinal, texto_normalizado,
            hash_texto, articulo_ref
        ) VALUES (%s, %s, %s, %s, %s, %s)
        ON CONFLICT (id_fragmento) DO NOTHING
    """, (
        id_fragmento_2,
        id_version_2,
        0,
        texto_2,
        hash_texto_2,
        'Artículo 2'
    ))
    
    # Add to pending_embeddings
    for id_frag in [id_fragmento_1, id_fragmento_2]:
        cursor.execute("""
            INSERT INTO pending_embeddings (id_fragmento, status)
            VALUES (%s, 'pending')
            ON CONFLICT (id_fragmento) DO UPDATE SET
                status = 'pending',
                attempts = 0,
                last_error = NULL
        """, (id_frag,))
    
    conn.commit()
    cursor.close()
    conn.close()
    
    print("\n✅ Test data inserted successfully")
    return [id_fragmento_1, id_fragmento_2]


def generate_embeddings_manually(fragmento_ids):
    """Generate embeddings for test fragmentos."""
    print_step(3, "Generating embeddings")
    
    conn = psycopg2.connect(
        host=DB_HOST,
        port=DB_PORT,
        dbname=DB_NAME,
        user=DB_USER,
        password=DB_PASS
    )
    cursor = conn.cursor()
    
    # Import embedding utilities
    sys.path.insert(0, '/home/runner/work/elocal-lawyer-ai/elocal-lawyer-ai/airflow/dags')
    from utils.embeddings import generate_embeddings, upsert_point, QDRANT_COLLECTION_VIG, ensure_collections_exist
    
    # Ensure collections exist
    ensure_collections_exist()
    
    for id_fragmento in fragmento_ids:
        print(f"Processing fragmento: {id_fragmento[:16]}...")
        
        # Get fragmento data
        cursor.execute("""
            SELECT 
                bf.texto_normalizado,
                bf.ordinal,
                bf.articulo_ref,
                bv.id_version,
                bv.id_norma,
                bv.id_bloque,
                bv.fecha_vigencia_desde,
                bv.vigencia_hasta,
                bb.tipo as tipo_bloque,
                bb.titulo_bloque,
                bn.url_html_consolidada,
                bb.url_bloque
            FROM boe_fragmento bf
            JOIN boe_version bv ON bf.id_version = bv.id_version
            JOIN boe_bloque bb ON bv.id_norma = bb.id_norma AND bv.id_bloque = bb.id_bloque
            JOIN boe_norma bn ON bv.id_norma = bn.id_norma
            WHERE bf.id_fragmento = %s
        """, (id_fragmento,))
        
        row = cursor.fetchone()
        if not row:
            print(f"  ✗ Fragmento not found")
            continue
        
        (texto, ordinal, articulo_ref, id_version, id_norma, id_bloque,
         vigencia_desde, vigencia_hasta, tipo_bloque, titulo_bloque,
         url_html, url_bloque) = row
        
        # Generate embedding
        print(f"  Generating embedding...")
        embedding = generate_embeddings(texto)
        
        # Prepare payload
        payload = {
            'id_fragmento': id_fragmento,
            'id_norma': id_norma,
            'id_bloque': id_bloque,
            'id_version': id_version,
            'ordinal': ordinal,
            'articulo_ref': articulo_ref,
            'vigencia_desde': vigencia_desde.isoformat() if vigencia_desde else None,
            'vigencia_hasta': vigencia_hasta.isoformat() if vigencia_hasta else None,
            'tipo_bloque': tipo_bloque,
            'titulo_bloque': titulo_bloque,
            'url_html_consolidada': url_html,
            'url_bloque': url_bloque
        }
        
        # Upsert to Qdrant vigente collection
        print(f"  Upserting to Qdrant...")
        upsert_point(
            collection=QDRANT_COLLECTION_VIG,
            point_id=id_fragmento,
            vector=embedding,
            payload=payload
        )
        
        # Mark as completed
        cursor.execute("""
            UPDATE pending_embeddings 
            SET status = 'completed', updated_at = CURRENT_TIMESTAMP
            WHERE id_fragmento = %s
        """, (id_fragmento,))
        conn.commit()
        
        print(f"  ✓ Completed")
    
    cursor.close()
    conn.close()
    
    print("\n✅ Embeddings generated successfully")


def test_query_vigente():
    """Test querying in vigente mode."""
    print_step(4, "Testing query (vigente mode)")
    
    query = {
        "question": "¿Cuál es el objeto de la ley de prueba?",
        "max_results": 3,
        "mode": "vigente"
    }
    
    print(f"Querying: {query['question']}")
    
    try:
        response = requests.post(
            f"{RAG_API_URL}/query",
            json=query,
            timeout=30
        )
        response.raise_for_status()
        
        result = response.json()
        
        print(f"\n📝 Answer:")
        print(result['answer'])
        
        print(f"\n📚 Sources ({len(result['sources'])}):")
        for i, source in enumerate(result['sources'], 1):
            print(f"\n  Source {i}:")
            print(f"    Norma: {source['id_norma']}")
            print(f"    Bloque: {source['titulo_bloque']}")
            print(f"    Artículo: {source.get('articulo_ref', 'N/A')}")
            print(f"    Score: {source['score']:.4f}")
            print(f"    Vigencia: {source.get('vigencia_desde', 'N/A')}")
        
        print("\n✅ Vigente query successful")
        return True
    except Exception as e:
        print(f"\n✗ Query failed: {e}")
        return False


def test_query_historico():
    """Test querying in historico mode."""
    print_step(5, "Testing query (historico mode)")
    
    query = {
        "question": "¿Cuál es el ámbito de aplicación?",
        "max_results": 3,
        "mode": "historico",
        "as_of_date": "2024-06-01"
    }
    
    print(f"Querying: {query['question']}")
    print(f"As of date: {query['as_of_date']}")
    
    try:
        response = requests.post(
            f"{RAG_API_URL}/query",
            json=query,
            timeout=30
        )
        response.raise_for_status()
        
        result = response.json()
        
        print(f"\n📝 Answer:")
        print(result['answer'])
        
        print(f"\n📚 Sources ({len(result['sources'])}):")
        for i, source in enumerate(result['sources'], 1):
            print(f"\n  Source {i}:")
            print(f"    Norma: {source['id_norma']}")
            print(f"    Bloque: {source['titulo_bloque']}")
            print(f"    Score: {source['score']:.4f}")
        
        print("\n✅ Historico query successful")
        return True
    except Exception as e:
        print(f"\n✗ Query failed: {e}")
        return False


def main():
    """Run smoke test."""
    print("""
╔════════════════════════════════════════════════════════════╗
║         BOE CONSOLIDADA RAG - SMOKE TEST                   ║
╚════════════════════════════════════════════════════════════╝
    """)
    
    try:
        # Step 1: Check services
        check_services()
        
        # Step 2: Insert test data
        fragmento_ids = insert_test_data()
        
        # Step 3: Generate embeddings
        generate_embeddings_manually(fragmento_ids)
        
        # Step 4: Test vigente query
        vigente_ok = test_query_vigente()
        
        # Step 5: Test historico query
        historico_ok = test_query_historico()
        
        # Summary
        print(f"\n{'='*60}")
        print("SMOKE TEST SUMMARY")
        print(f"{'='*60}")
        print(f"Vigente mode: {'✅ PASS' if vigente_ok else '❌ FAIL'}")
        print(f"Historico mode: {'✅ PASS' if historico_ok else '❌ FAIL'}")
        
        if vigente_ok and historico_ok:
            print("\n🎉 ALL TESTS PASSED!")
            return 0
        else:
            print("\n❌ SOME TESTS FAILED")
            return 1
    
    except Exception as e:
        print(f"\n❌ SMOKE TEST FAILED: {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == '__main__':
    sys.exit(main())
