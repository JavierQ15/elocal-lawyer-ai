"""
DAG for initial load of BOE legislation data.
This DAG performs a complete initial ingestion of BOE consolidated legislation.
"""
from datetime import datetime, timedelta
from airflow import DAG
from airflow.operators.python import PythonOperator
from airflow.providers.postgres.hooks.postgres import PostgresHook
import sys
sys.path.insert(0, '/opt/airflow/dags')
from utils.boe_scraper import fetch_boe_documents, process_document
from utils.embeddings import generate_embeddings, store_in_qdrant
from utils.idempotency import calculate_hash, check_document_exists


default_args = {
    'owner': 'airflow',
    'depends_on_past': False,
    'email_on_failure': False,
    'email_on_retry': False,
    'retries': 3,
    'retry_delay': timedelta(minutes=5),
}


def fetch_and_store_documents(**context):
    """
    Fetch BOE documents and store them in PostgreSQL.
    Uses content hash for idempotency - skips documents that already exist.
    """
    import os
    import psycopg2
    from datetime import datetime, timedelta
    
    # Connect to PostgreSQL
    pg_hook = PostgresHook(postgres_conn_id='postgres_default')
    conn = pg_hook.get_conn()
    cursor = conn.cursor()
    
    # Fetch documents from BOE (last 30 days for initial load demo)
    end_date = datetime.now()
    start_date = end_date - timedelta(days=30)
    
    documents = fetch_boe_documents(start_date, end_date)
    
    processed_count = 0
    skipped_count = 0
    
    for doc in documents:
        # Calculate content hash for idempotency
        content_hash = calculate_hash(doc['full_text'])
        
        # Check if document already exists
        if check_document_exists(cursor, doc['boe_id'], content_hash):
            skipped_count += 1
            continue
        
        # Insert document
        cursor.execute("""
            INSERT INTO boe_documents 
            (boe_id, title, summary, publication_date, document_type, 
             department, section, url, pdf_url, content_hash, full_text, metadata)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (boe_id) DO UPDATE SET
                title = EXCLUDED.title,
                summary = EXCLUDED.summary,
                content_hash = EXCLUDED.content_hash,
                full_text = EXCLUDED.full_text,
                updated_at = CURRENT_TIMESTAMP
            RETURNING id
        """, (
            doc['boe_id'],
            doc['title'],
            doc['summary'],
            doc['publication_date'],
            doc['document_type'],
            doc['department'],
            doc['section'],
            doc['url'],
            doc['pdf_url'],
            content_hash,
            doc['full_text'],
            psycopg2.extras.Json(doc['metadata'])
        ))
        
        processed_count += 1
        
        # Log to ingestion_log
        cursor.execute("""
            INSERT INTO ingestion_log (boe_id, status, ingestion_type)
            VALUES (%s, %s, %s)
        """, (doc['boe_id'], 'completed', 'initial'))
    
    conn.commit()
    cursor.close()
    conn.close()
    
    print(f"Processed {processed_count} documents, skipped {skipped_count} existing documents")
    context['task_instance'].xcom_push(key='processed_count', value=processed_count)
    context['task_instance'].xcom_push(key='skipped_count', value=skipped_count)


def chunk_and_embed_documents(**context):
    """
    Chunk documents and generate embeddings.
    Uses chunk hash for idempotency - skips chunks that already exist.
    """
    import os
    from utils.text_processing import chunk_text
    
    # Connect to PostgreSQL
    pg_hook = PostgresHook(postgres_conn_id='postgres_default')
    conn = pg_hook.get_conn()
    cursor = conn.cursor()
    
    # Get documents that need to be chunked (no chunks yet)
    cursor.execute("""
        SELECT d.id, d.boe_id, d.full_text, d.title, d.metadata
        FROM boe_documents d
        LEFT JOIN document_chunks c ON d.id = c.document_id
        WHERE c.id IS NULL
        ORDER BY d.publication_date DESC
        LIMIT 100
    """)
    
    documents = cursor.fetchall()
    
    chunked_count = 0
    
    for doc_id, boe_id, full_text, title, metadata in documents:
        # Chunk the document
        chunks = chunk_text(full_text, chunk_size=1000, overlap=200)
        
        for idx, chunk in enumerate(chunks):
            chunk_hash = calculate_hash(chunk)
            
            # Check if chunk already exists
            cursor.execute("""
                SELECT id FROM document_chunks 
                WHERE document_id = %s AND chunk_hash = %s
            """, (doc_id, chunk_hash))
            
            if cursor.fetchone():
                continue
            
            # Generate embedding
            embedding = generate_embeddings(chunk)
            
            # Store in Qdrant and get vector_id
            vector_id = store_in_qdrant(
                embedding=embedding,
                text=chunk,
                metadata={
                    'document_id': str(doc_id),
                    'boe_id': boe_id,
                    'chunk_index': idx,
                    'title': title,
                    **(metadata or {})
                }
            )
            
            # Store chunk in PostgreSQL
            cursor.execute("""
                INSERT INTO document_chunks 
                (document_id, chunk_index, chunk_text, chunk_hash, vector_id, metadata)
                VALUES (%s, %s, %s, %s, %s, %s)
            """, (
                doc_id,
                idx,
                chunk,
                chunk_hash,
                vector_id,
                psycopg2.extras.Json({'title': title})
            ))
        
        chunked_count += 1
    
    conn.commit()
    cursor.close()
    conn.close()
    
    print(f"Chunked and embedded {chunked_count} documents")
    context['task_instance'].xcom_push(key='chunked_count', value=chunked_count)


with DAG(
    'boe_initial_load',
    default_args=default_args,
    description='Initial load of BOE legislation data with idempotency',
    schedule_interval=None,  # Manual trigger only
    start_date=datetime(2024, 1, 1),
    catchup=False,
    tags=['boe', 'initial-load'],
) as dag:
    
    fetch_task = PythonOperator(
        task_id='fetch_and_store_documents',
        python_callable=fetch_and_store_documents,
        provide_context=True,
    )
    
    chunk_task = PythonOperator(
        task_id='chunk_and_embed_documents',
        python_callable=chunk_and_embed_documents,
        provide_context=True,
    )
    
    fetch_task >> chunk_task
