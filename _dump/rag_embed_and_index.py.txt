"""
DAG for generating embeddings and indexing in Qdrant.
This DAG runs hourly to:
1. Fetch pending fragmentos from pending_embeddings
2. Generate embeddings using Ollama
3. Upsert to boe_historico_all collection
4. Refresh boe_vigente_latest collection with current versions
5. Mark fragmentos as completed

This is resumable: if it crashes, it will pick up where it left off.
"""
from datetime import datetime, timedelta
from airflow import DAG
from airflow.operators.python import PythonOperator
from airflow.providers.postgres.hooks.postgres import PostgresHook
import sys
sys.path.insert(0, '/opt/airflow/dags')

from utils.embeddings import (
    generate_embeddings,
    upsert_point,
    ensure_collections_exist,
    QDRANT_COLLECTION_HIST,
    QDRANT_COLLECTION_VIG
)

default_args = {
    'owner': 'airflow',
    'depends_on_past': False,
    'email_on_failure': False,
    'email_on_retry': False,
    'retries': 3,
    'retry_delay': timedelta(minutes=5),
}


def fetch_and_embed_pending(**context):
    """
    Tarea 1: Fetch pending embeddings, generate embeddings, and upsert to historico.
    Procesa en batches de 50 para eficiencia y resiliencia.
    """
    import logging
    logger = logging.getLogger(__name__)
    
    BATCH_SIZE = 50
    MAX_BATCHES = 20  # Limitar a 1000 fragmentos por ejecución
    
    pg_hook = PostgresHook(postgres_conn_id='postgres_default')
    conn = pg_hook.get_conn()
    cursor = conn.cursor()
    
    # Asegurar que las colecciones existen
    ensure_collections_exist()
    
    total_processed = 0
    total_embedded = 0
    
    for batch_num in range(MAX_BATCHES):
        logger.info(f"Processing batch {batch_num + 1}/{MAX_BATCHES}")
        
        # Fetch pending fragmentos
        cursor.execute("""
            SELECT 
                pe.id_fragmento,
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
            FROM pending_embeddings pe
            JOIN boe_fragmento bf ON pe.id_fragmento = bf.id_fragmento
            JOIN boe_version bv ON bf.id_version = bv.id_version
            JOIN boe_bloque bb ON bv.id_norma = bb.id_norma AND bv.id_bloque = bb.id_bloque
            JOIN boe_norma bn ON bv.id_norma = bn.id_norma
            WHERE pe.status = 'pending'
            ORDER BY pe.created_at
            LIMIT %s
        """, (BATCH_SIZE,))
        
        rows = cursor.fetchall()
        
        if not rows:
            logger.info("No more pending fragmentos")
            break
        
        logger.info(f"Found {len(rows)} pending fragmentos in this batch")
        
        for row in rows:
            (id_fragmento, texto, ordinal, articulo_ref, id_version, 
             id_norma, id_bloque, vigencia_desde, vigencia_hasta,
             tipo_bloque, titulo_bloque, url_html_consolidada, url_bloque) = row
            
            try:
                # Marcar como processing
                cursor.execute("""
                    UPDATE pending_embeddings 
                    SET status = 'processing', updated_at = CURRENT_TIMESTAMP
                    WHERE id_fragmento = %s
                """, (id_fragmento,))
                conn.commit()
                
                # Generar embedding
                embedding = generate_embeddings(texto)
                
                # Preparar payload (sin texto completo, solo metadatos)
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
                    'url_html_consolidada': url_html_consolidada,
                    'url_bloque': url_bloque
                }
                
                # Upsert a colección histórica
                upsert_point(
                    collection=QDRANT_COLLECTION_HIST,
                    point_id=id_fragmento,
                    vector=embedding,
                    payload=payload
                )
                
                # Marcar como completed
                cursor.execute("""
                    UPDATE pending_embeddings 
                    SET status = 'completed', updated_at = CURRENT_TIMESTAMP
                    WHERE id_fragmento = %s
                """, (id_fragmento,))
                conn.commit()
                
                total_embedded += 1
                total_processed += 1
                
            except Exception as e:
                logger.error(f"Error processing fragmento {id_fragmento}: {e}")
                
                # Marcar como failed
                cursor.execute("""
                    UPDATE pending_embeddings 
                    SET status = 'failed', 
                        attempts = attempts + 1,
                        last_error = %s,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id_fragmento = %s
                """, (str(e)[:500], id_fragmento))
                conn.commit()
                
                total_processed += 1
        
        logger.info(f"Batch {batch_num + 1} completed: {total_embedded} embedded so far")
    
    cursor.close()
    conn.close()
    
    logger.info(f"Total processed: {total_processed}, embedded: {total_embedded}")
    
    context['task_instance'].xcom_push(key='embedded_count', value=total_embedded)
    return total_embedded


def refresh_vigente_collection(**context):
    """
    Tarea 2: Refresh la colección vigente con las versiones actuales.
    
    Para cada (id_norma, id_bloque), determina la versión vigente HOY y
    actualiza solo esos fragmentos en boe_vigente_latest.
    
    Estrategia:
    - Calcular vigencia_hasta de cada versión basándose en la siguiente versión
    - Seleccionar versión vigente hoy (fecha_vigencia_desde <= hoy AND vigencia_hasta > hoy OR NULL)
    - Upsert fragmentos de versión vigente a boe_vigente_latest
    """
    import logging
    from datetime import date
    logger = logging.getLogger(__name__)
    
    pg_hook = PostgresHook(postgres_conn_id='postgres_default')
    conn = pg_hook.get_conn()
    cursor = conn.cursor()
    
    # Fecha de hoy
    hoy = date.today()
    
    logger.info(f"Refreshing vigente collection as of {hoy}")
    
    # Primero, actualizar vigencia_hasta de todas las versiones
    # Una versión termina cuando empieza la siguiente
    logger.info("Updating vigencia_hasta for all versions...")
    
    cursor.execute("""
        WITH next_versions AS (
            SELECT 
                id_version,
                id_norma,
                id_bloque,
                fecha_vigencia_desde,
                LEAD(fecha_vigencia_desde) OVER (
                    PARTITION BY id_norma, id_bloque 
                    ORDER BY fecha_vigencia_desde
                ) as siguiente_vigencia
            FROM boe_version
        )
        UPDATE boe_version bv
        SET vigencia_hasta = nv.siguiente_vigencia
        FROM next_versions nv
        WHERE bv.id_version = nv.id_version
          AND bv.vigencia_hasta IS DISTINCT FROM nv.siguiente_vigencia
    """)
    
    updated_count = cursor.rowcount
    conn.commit()
    logger.info(f"Updated vigencia_hasta for {updated_count} versions")
    
    # Obtener fragmentos de versiones vigentes
    logger.info("Fetching current vigente fragmentos...")
    
    cursor.execute("""
        SELECT 
            bf.id_fragmento,
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
        WHERE bv.fecha_vigencia_desde <= %s
          AND (bv.vigencia_hasta IS NULL OR bv.vigencia_hasta > %s)
          AND EXISTS (
              SELECT 1 FROM pending_embeddings pe 
              WHERE pe.id_fragmento = bf.id_fragmento 
                AND pe.status = 'completed'
          )
    """, (hoy, hoy))
    
    vigente_rows = cursor.fetchall()
    logger.info(f"Found {len(vigente_rows)} vigente fragmentos")
    
    # Upsert a colección vigente
    upsert_count = 0
    
    for row in vigente_rows:
        (id_fragmento, texto, ordinal, articulo_ref, id_version,
         id_norma, id_bloque, vigencia_desde, vigencia_hasta,
         tipo_bloque, titulo_bloque, url_html_consolidada, url_bloque) = row
        
        try:
            # Generar embedding (o recuperar de histórico - por ahora regeneramos)
            embedding = generate_embeddings(texto)
            
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
                'url_html_consolidada': url_html_consolidada,
                'url_bloque': url_bloque
            }
            
            # Upsert a colección vigente
            upsert_point(
                collection=QDRANT_COLLECTION_VIG,
                point_id=id_fragmento,
                vector=embedding,
                payload=payload
            )
            
            upsert_count += 1
            
        except Exception as e:
            logger.error(f"Error upserting vigente fragmento {id_fragmento}: {e}")
    
    cursor.close()
    conn.close()
    
    logger.info(f"Refreshed {upsert_count} fragmentos in vigente collection")
    
    context['task_instance'].xcom_push(key='vigente_refreshed', value=upsert_count)
    return upsert_count


def cleanup_failed(**context):
    """
    Tarea 3 (opcional): Limpiar intentos fallidos para retry.
    Si un fragmento ha fallado más de 5 veces, marcarlo como 'failed_permanent'.
    """
    import logging
    logger = logging.getLogger(__name__)
    
    pg_hook = PostgresHook(postgres_conn_id='postgres_default')
    conn = pg_hook.get_conn()
    cursor = conn.cursor()
    
    # Marcar como permanently failed si han fallado > 5 veces
    cursor.execute("""
        UPDATE pending_embeddings
        SET status = 'failed_permanent'
        WHERE status = 'failed' AND attempts >= 5
    """)
    
    permanent_failed = cursor.rowcount
    conn.commit()
    
    # Resetear failed a pending para retry (si attempts < 5)
    cursor.execute("""
        UPDATE pending_embeddings
        SET status = 'pending'
        WHERE status = 'failed' AND attempts < 5
    """)
    
    retried = cursor.rowcount
    conn.commit()
    
    cursor.close()
    conn.close()
    
    logger.info(f"Marked {permanent_failed} as permanent failures, retrying {retried}")
    return {'permanent_failed': permanent_failed, 'retried': retried}


# Define el DAG
with DAG(
    'rag_embed_and_index',
    default_args=default_args,
    description='Generate embeddings and index in Qdrant (historical + vigente)',
    schedule_interval='0 * * * *',  # Cada hora
    start_date=datetime(2024, 1, 1),
    catchup=False,
    max_active_runs=1,
    tags=['boe', 'embeddings', 'qdrant'],
) as dag:
    
    task_embed = PythonOperator(
        task_id='fetch_and_embed_pending',
        python_callable=fetch_and_embed_pending,
        provide_context=True,
    )
    
    task_refresh_vigente = PythonOperator(
        task_id='refresh_vigente_collection',
        python_callable=refresh_vigente_collection,
        provide_context=True,
    )
    
    task_cleanup = PythonOperator(
        task_id='cleanup_failed',
        python_callable=cleanup_failed,
        provide_context=True,
    )
    
    # Flujo
    task_embed >> task_refresh_vigente >> task_cleanup
