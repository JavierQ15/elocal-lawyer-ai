"""
DAG for incremental updates of BOE legislation data.
This DAG runs daily to check for new/updated BOE documents.
"""
from datetime import datetime, timedelta
from airflow import DAG
from airflow.operators.python import PythonOperator
from airflow.providers.postgres.hooks.postgres import PostgresHook
import sys
sys.path.insert(0, '/opt/airflow/dags')
from utils.boe_scraper import fetch_boe_documents
from utils.embeddings import generate_embeddings, store_in_qdrant
from utils.idempotency import calculate_hash, check_document_exists
from utils.text_processing import chunk_text


default_args = {
    'owner': 'airflow',
    'depends_on_past': False,
    'email_on_failure': False,
    'email_on_retry': False,
    'retries': 2,
    'retry_delay': timedelta(minutes=5),
}


def fetch_incremental_updates(**context):
    """
    Fetch new BOE documents from the last day.
    Uses content hash for idempotency.
    """
    import psycopg2
    from datetime import datetime, timedelta
    
    # Connect to PostgreSQL
    pg_hook = PostgresHook(postgres_conn_id='postgres_default')
    conn = pg_hook.get_conn()
    cursor = conn.cursor()
    
    # Fetch documents from yesterday
    end_date = datetime.now()
    start_date = end_date - timedelta(days=1)
    
    documents = fetch_boe_documents(start_date, end_date)
    
    new_count = 0
    updated_count = 0
    skipped_count = 0
    
    for doc in documents:
        # Calculate content hash
        content_hash = calculate_hash(doc['full_text'])
        
        # Check if document exists with same hash (no changes)
        if check_document_exists(cursor, doc['boe_id'], content_hash):
            skipped_count += 1
            continue
        
        # Check if document exists but with different hash (updated)
        cursor.execute("""
            SELECT id FROM boe_documents WHERE boe_id = %s
        """, (doc['boe_id'],))
        
        existing = cursor.fetchone()
        
        if existing:
            # Update existing document
            cursor.execute("""
                UPDATE boe_documents SET
                    title = %s,
                    summary = %s,
                    content_hash = %s,
                    full_text = %s,
                    metadata = %s,
                    updated_at = CURRENT_TIMESTAMP
                WHERE boe_id = %s
            """, (
                doc['title'],
                doc['summary'],
                content_hash,
                doc['full_text'],
                psycopg2.extras.Json(doc['metadata']),
                doc['boe_id']
            ))
            
            # Delete old chunks (will be re-created)
            cursor.execute("""
                DELETE FROM document_chunks WHERE document_id = %s
            """, (existing[0],))
            
            updated_count += 1
        else:
            # Insert new document
            cursor.execute("""
                INSERT INTO boe_documents 
                (boe_id, title, summary, publication_date, document_type, 
                 department, section, url, pdf_url, content_hash, full_text, metadata)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
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
            
            new_count += 1
        
        # Log to ingestion_log
        cursor.execute("""
            INSERT INTO ingestion_log (boe_id, status, ingestion_type)
            VALUES (%s, %s, %s)
        """, (doc['boe_id'], 'completed', 'incremental'))
    
    conn.commit()
    cursor.close()
    conn.close()
    
    print(f"New: {new_count}, Updated: {updated_count}, Skipped: {skipped_count}")
    context['task_instance'].xcom_push(key='new_count', value=new_count)
    context['task_instance'].xcom_push(key='updated_count', value=updated_count)
    context['task_instance'].xcom_push(key='skipped_count', value=skipped_count)


def process_new_chunks(**context):
    """
    Process documents that don't have chunks yet.
    """
    import psycopg2
    
    # Connect to PostgreSQL
    pg_hook = PostgresHook(postgres_conn_id='postgres_default')
    conn = pg_hook.get_conn()
    cursor = conn.cursor()
    
    # Get documents without chunks
    cursor.execute("""
        SELECT d.id, d.boe_id, d.full_text, d.title, d.metadata
        FROM boe_documents d
        LEFT JOIN document_chunks c ON d.id = c.document_id
        WHERE c.id IS NULL
        ORDER BY d.publication_date DESC
    """)
    
    documents = cursor.fetchall()
    
    processed_count = 0
    
    for doc_id, boe_id, full_text, title, metadata in documents:
        # Chunk the document
        chunks = chunk_text(full_text, chunk_size=1000, overlap=200)
        
        for idx, chunk in enumerate(chunks):
            chunk_hash = calculate_hash(chunk)
            
            # Generate embedding
            embedding = generate_embeddings(chunk)
            
            # Store in Qdrant
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
        
        processed_count += 1
    
    conn.commit()
    cursor.close()
    conn.close()
    
    print(f"Processed {processed_count} documents into chunks")
    context['task_instance'].xcom_push(key='processed_count', value=processed_count)


with DAG(
    'boe_incremental_update',
    default_args=default_args,
    description='Daily incremental update of BOE legislation',
    schedule_interval='0 2 * * *',  # Run daily at 2 AM
    start_date=datetime(2024, 1, 1),
    catchup=False,
    tags=['boe', 'incremental'],
) as dag:
    
    fetch_task = PythonOperator(
        task_id='fetch_incremental_updates',
        python_callable=fetch_incremental_updates,
        provide_context=True,
    )
    
    chunk_task = PythonOperator(
        task_id='process_new_chunks',
        python_callable=process_new_chunks,
        provide_context=True,
    )
    
    fetch_task >> chunk_task
