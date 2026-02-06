"""
DAG for synchronizing BOE Consolidated Legislation (Legislación Consolidada).
This DAG runs daily to:
1. Discover normas updated in the last day
2. Sync indices (bloques) for updated normas
3. Sync bloques content (versiones) and generate fragmentos

This is the INCREMENTAL sync DAG. For initial load, trigger it with a wider date range.
"""
from datetime import datetime, timedelta
from airflow import DAG
from airflow.operators.python import PythonOperator
from airflow.providers.postgres.hooks.postgres import PostgresHook
from airflow.utils.task_group import TaskGroup
import sys
import json
sys.path.insert(0, '/opt/airflow/dags')

from utils.boe_consolidada_client import get_client
from utils.text_processing import html_to_text_structured, chunk_text_by_article_or_size
from utils.idempotency import (
    calculate_hash, 
    generate_id_version, 
    generate_id_fragmento,
    check_version_exists,
    check_fragmento_exists
)

default_args = {
    'owner': 'airflow',
    'depends_on_past': False,
    'email_on_failure': False,
    'email_on_retry': False,
    'retries': 3,
    'retry_delay': timedelta(minutes=5),
}


def discover_normas(**context):
    """
    Tarea 1: Descubre normas actualizadas llamando a list_normas.
    Guarda/actualiza en boe_norma y pushea lista de id_norma para procesar.
    """
    import logging
    logger = logging.getLogger(__name__)
    
    # Obtener rango de fechas (ayer por defecto)
    execution_date = context['execution_date']
    from_date = (execution_date - timedelta(days=1)).date()
    to_date = execution_date.date()
    
    # Permitir override con parámetros del DAG
    dag_run_conf = context.get('dag_run', {}).conf or {}
    if 'from_date' in dag_run_conf:
        from_date = datetime.strptime(dag_run_conf['from_date'], '%Y-%m-%d').date()
    if 'to_date' in dag_run_conf:
        to_date = datetime.strptime(dag_run_conf['to_date'], '%Y-%m-%d').date()
    
    logger.info(f"Discovering normas from {from_date} to {to_date}")
    
    # Llamar a la API
    client = get_client()
    normas = client.list_normas(
        from_date=from_date,
        to_date=to_date,
        offset=0,
        limit=-1  # Traer todas
    )
    
    logger.info(f"Found {len(normas)} normas")
    
    # Guardar en base de datos
    pg_hook = PostgresHook(postgres_conn_id='postgres_default')
    conn = pg_hook.get_conn()
    cursor = conn.cursor()
    
    id_normas_to_process = []
    
    for norma in normas:
        try:
            cursor.execute("""
                INSERT INTO boe_norma (
                    id_norma, titulo, rango, departamento, ambito,
                    fecha_publicacion, fecha_disposicion, url_html_consolidada,
                    url_eli, fecha_actualizacion_api, metadata_jsonb, last_seen_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP)
                ON CONFLICT (id_norma) DO UPDATE SET
                    titulo = EXCLUDED.titulo,
                    rango = EXCLUDED.rango,
                    departamento = EXCLUDED.departamento,
                    ambito = EXCLUDED.ambito,
                    fecha_publicacion = EXCLUDED.fecha_publicacion,
                    fecha_disposicion = EXCLUDED.fecha_disposicion,
                    url_html_consolidada = EXCLUDED.url_html_consolidada,
                    url_eli = EXCLUDED.url_eli,
                    fecha_actualizacion_api = EXCLUDED.fecha_actualizacion_api,
                    metadata_jsonb = EXCLUDED.metadata_jsonb,
                    last_seen_at = CURRENT_TIMESTAMP
            """, (
                norma.get('id_norma'),
                norma.get('titulo'),
                norma.get('rango'),
                norma.get('departamento'),
                norma.get('ambito'),
                norma.get('fecha_publicacion'),
                norma.get('fecha_disposicion'),
                norma.get('url_html_consolidada'),
                norma.get('url_eli'),
                norma.get('fecha_actualizacion_api'),
                json.dumps(norma.get('metadata', {}))
            ))
            
            id_normas_to_process.append(norma.get('id_norma'))
        except Exception as e:
            logger.error(f"Error upserting norma {norma.get('id_norma')}: {e}")
    
    conn.commit()
    cursor.close()
    conn.close()
    
    logger.info(f"Upserted {len(id_normas_to_process)} normas")
    
    # Pushear lista para siguientes tareas
    context['task_instance'].xcom_push(key='id_normas', value=id_normas_to_process)
    return id_normas_to_process


def sync_indices(**context):
    """
    Tarea 2: Sincroniza índices de las normas descubiertas.
    Para cada norma, obtiene su índice (estructura de bloques) y detecta cambios.
    """
    import logging
    logger = logging.getLogger(__name__)
    
    # Obtener lista de normas a procesar
    id_normas = context['task_instance'].xcom_pull(
        task_ids='discover_normas', 
        key='id_normas'
    )
    
    if not id_normas:
        logger.info("No normas to process")
        return []
    
    logger.info(f"Processing indices for {len(id_normas)} normas")
    
    client = get_client()
    pg_hook = PostgresHook(postgres_conn_id='postgres_default')
    conn = pg_hook.get_conn()
    cursor = conn.cursor()
    
    dirty_bloques = []  # Lista de (id_norma, id_bloque) que necesitan actualización
    
    for id_norma in id_normas:
        try:
            logger.info(f"Fetching indice for {id_norma}")
            indice = client.get_indice(id_norma)
            
            for bloque in indice.get('bloques', []):
                id_bloque = bloque.get('id_bloque')
                fecha_actualizacion_bloque = bloque.get('fecha_actualizacion_bloque')
                
                # Verificar si el bloque cambió
                cursor.execute("""
                    SELECT fecha_actualizacion_bloque 
                    FROM boe_bloque 
                    WHERE id_norma = %s AND id_bloque = %s
                """, (id_norma, id_bloque))
                
                row = cursor.fetchone()
                is_dirty = False
                
                if not row:
                    # Bloque nuevo
                    is_dirty = True
                elif row[0] != fecha_actualizacion_bloque:
                    # Bloque actualizado
                    is_dirty = True
                
                # Upsert bloque
                cursor.execute("""
                    INSERT INTO boe_bloque (
                        id_norma, id_bloque, tipo, titulo_bloque,
                        fecha_actualizacion_bloque, url_bloque
                    ) VALUES (%s, %s, %s, %s, %s, %s)
                    ON CONFLICT (id_norma, id_bloque) DO UPDATE SET
                        tipo = EXCLUDED.tipo,
                        titulo_bloque = EXCLUDED.titulo_bloque,
                        fecha_actualizacion_bloque = EXCLUDED.fecha_actualizacion_bloque,
                        url_bloque = EXCLUDED.url_bloque
                """, (
                    id_norma,
                    id_bloque,
                    bloque.get('tipo'),
                    bloque.get('titulo_bloque'),
                    fecha_actualizacion_bloque,
                    bloque.get('url_bloque')
                ))
                
                if is_dirty:
                    dirty_bloques.append({
                        'id_norma': id_norma,
                        'id_bloque': id_bloque
                    })
        
        except Exception as e:
            logger.error(f"Error processing indice for {id_norma}: {e}")
    
    conn.commit()
    cursor.close()
    conn.close()
    
    logger.info(f"Found {len(dirty_bloques)} dirty bloques to sync")
    
    # Pushear bloques dirty
    context['task_instance'].xcom_push(key='dirty_bloques', value=dirty_bloques)
    return dirty_bloques


def sync_bloques_batch(**context):
    """
    Tarea 3: Sincroniza contenido de bloques dirty (versiones).
    Procesa bloques en batch para eficiencia.
    """
    import logging
    logger = logging.getLogger(__name__)
    
    # Obtener bloques dirty
    dirty_bloques = context['task_instance'].xcom_pull(
        task_ids='sync_indices',
        key='dirty_bloques'
    )
    
    if not dirty_bloques:
        logger.info("No dirty bloques to process")
        return 0
    
    logger.info(f"Processing {len(dirty_bloques)} dirty bloques")
    
    client = get_client()
    pg_hook = PostgresHook(postgres_conn_id='postgres_default')
    conn = pg_hook.get_conn()
    cursor = conn.cursor()
    
    processed_count = 0
    new_fragmentos_count = 0
    
    for bloque_ref in dirty_bloques:
        id_norma = bloque_ref['id_norma']
        id_bloque = bloque_ref['id_bloque']
        
        try:
            logger.info(f"Fetching bloque {id_norma}/{id_bloque}")
            bloque_data = client.get_bloque(id_norma, id_bloque)
            
            # Procesar cada versión del bloque
            versiones = bloque_data.get('versiones', [])
            logger.info(f"Found {len(versiones)} versions for {id_norma}/{id_bloque}")
            
            for version in versiones:
                html = version.get('html', '')
                if not html:
                    continue
                
                # Calcular hashes
                hash_html = calculate_hash(html)
                texto_normalizado = html_to_text_structured(html)
                hash_texto = calculate_hash(texto_normalizado)
                
                # Generar ID determinista para la versión
                id_version = generate_id_version(
                    id_norma=id_norma,
                    id_bloque=id_bloque,
                    fecha_vigencia_desde=version.get('fecha_vigencia_desde'),
                    id_norma_modificadora=version.get('id_norma_modificadora'),
                    hash_html=hash_html
                )
                
                # Verificar si la versión ya existe con el mismo hash
                if check_version_exists(cursor, id_version):
                    # Ya existe, skip
                    continue
                
                # Calcular vigencia_hasta
                # NOTE: vigencia_hasta is calculated later in refresh_vigente_collection task
                # This field will be set to the fecha_vigencia_desde of the next version
                vigencia_hasta = None
                
                # Upsert versión
                cursor.execute("""
                    INSERT INTO boe_version (
                        id_version, id_norma, id_bloque, id_norma_modificadora,
                        fecha_publicacion_mod, fecha_vigencia_desde, vigencia_hasta,
                        hash_html, hash_texto
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (id_version) DO UPDATE SET
                        id_norma_modificadora = EXCLUDED.id_norma_modificadora,
                        fecha_publicacion_mod = EXCLUDED.fecha_publicacion_mod,
                        vigencia_hasta = EXCLUDED.vigencia_hasta,
                        hash_html = EXCLUDED.hash_html,
                        hash_texto = EXCLUDED.hash_texto
                """, (
                    id_version,
                    id_norma,
                    id_bloque,
                    version.get('id_norma_modificadora'),
                    version.get('fecha_publicacion_mod'),
                    version.get('fecha_vigencia_desde'),
                    vigencia_hasta,
                    hash_html,
                    hash_texto
                ))
                
                # Chunkear el texto
                chunks = chunk_text_by_article_or_size(texto_normalizado)
                
                for chunk_data in chunks:
                    chunk_text = chunk_data['text']
                    articulo_ref = chunk_data.get('articulo_ref')
                    ordinal = chunk_data['ordinal']
                    
                    chunk_hash = calculate_hash(chunk_text)
                    
                    # Generar ID determinista para fragmento
                    id_fragmento = generate_id_fragmento(
                        id_version=id_version,
                        ordinal=ordinal,
                        hash_texto=chunk_hash
                    )
                    
                    # Verificar si el fragmento ya existe
                    if check_fragmento_exists(cursor, id_fragmento):
                        continue
                    
                    # Insertar fragmento
                    cursor.execute("""
                        INSERT INTO boe_fragmento (
                            id_fragmento, id_version, ordinal, texto_normalizado,
                            hash_texto, articulo_ref
                        ) VALUES (%s, %s, %s, %s, %s, %s)
                        ON CONFLICT (id_fragmento) DO NOTHING
                    """, (
                        id_fragmento,
                        id_version,
                        ordinal,
                        chunk_text,
                        chunk_hash,
                        articulo_ref
                    ))
                    
                    # Añadir a pending_embeddings
                    cursor.execute("""
                        INSERT INTO pending_embeddings (id_fragmento, status)
                        VALUES (%s, 'pending')
                        ON CONFLICT (id_fragmento) DO NOTHING
                    """, (id_fragmento,))
                    
                    new_fragmentos_count += 1
            
            processed_count += 1
            
            # Commit cada N bloques para no perder progreso
            if processed_count % 10 == 0:
                conn.commit()
                logger.info(f"Committed progress: {processed_count} bloques processed")
        
        except Exception as e:
            logger.error(f"Error processing bloque {id_norma}/{id_bloque}: {e}")
    
    conn.commit()
    cursor.close()
    conn.close()
    
    logger.info(f"Processed {processed_count} bloques, created {new_fragmentos_count} new fragmentos")
    return processed_count


# Define el DAG
with DAG(
    'boe_sync_consolidada',
    default_args=default_args,
    description='Synchronize BOE Consolidated Legislation (incremental)',
    schedule_interval='0 2 * * *',  # Diario a las 2 AM
    start_date=datetime(2024, 1, 1),
    catchup=False,
    max_active_runs=1,
    tags=['boe', 'consolidada', 'incremental'],
) as dag:
    
    task_discover = PythonOperator(
        task_id='discover_normas',
        python_callable=discover_normas,
        provide_context=True,
    )
    
    task_sync_indices = PythonOperator(
        task_id='sync_indices',
        python_callable=sync_indices,
        provide_context=True,
    )
    
    task_sync_bloques = PythonOperator(
        task_id='sync_bloques_batch',
        python_callable=sync_bloques_batch,
        provide_context=True,
    )
    
    # Definir flujo
    task_discover >> task_sync_indices >> task_sync_bloques
