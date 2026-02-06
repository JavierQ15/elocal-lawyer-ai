"""
Cliente para la API de Legislación Consolidada del BOE.
API Docs: https://www.boe.es/datosabiertos/documentacion/legislacion-consolidada

Este módulo NO hace scraping HTML. Usa la API oficial del BOE para:
- Listar normas consolidadas
- Obtener índice de una norma
- Obtener bloques con versiones

Features:
- Automatic retry with exponential backoff for transient network errors
- Rate limiting protection
- Connection pooling and keep-alive
"""
import os
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from datetime import datetime, date
from typing import Dict, List, Optional, Any
import xml.etree.ElementTree as ET
import json
import logging
import time

logger = logging.getLogger(__name__)

# BOE date format constants
BOE_DATE_FORMAT_LENGTH = 8  # YYYYMMDD format

BOE_CONSOLIDADA_BASE_URL = os.getenv(
    'BOE_CONSOLIDADA_BASE_URL', 
    'https://www.boe.es/datosabiertos/api/legislacion-consolidada'
)
BOE_API_TIMEOUT = int(os.getenv('BOE_API_TIMEOUT', '30'))
BOE_CONSOLIDADA_INDICE_PATH_TEMPLATE = os.getenv(
    'BOE_CONSOLIDADA_INDICE_PATH_TEMPLATE',
    '{base}/id/{id_norma}/texto/indice'
)
BOE_CONSOLIDADA_BLOQUE_PATH_TEMPLATE = os.getenv(
    'BOE_CONSOLIDADA_BLOQUE_PATH_TEMPLATE',
    '{base}/id/{id_norma}/texto/bloque/{id_bloque}'
)


class BOEConsolidadaClient:
    """
    Cliente para interactuar con la API de Legislación Consolidada del BOE.
    
    Features:
    - Automatic retry with exponential backoff for network errors
    - Connection pooling for better performance
    - Rate limiting protection
    """
    
    def __init__(self, base_url: str = BOE_CONSOLIDADA_BASE_URL, timeout: int = BOE_API_TIMEOUT):
        self.base_url = base_url
        self.timeout = timeout
        self.indice_path_template = BOE_CONSOLIDADA_INDICE_PATH_TEMPLATE
        self.bloque_path_template = BOE_CONSOLIDADA_BLOQUE_PATH_TEMPLATE
        
        # Configure session with retry strategy
        self.session = requests.Session()
        
        # Retry strategy: retry on connection errors, timeouts, and 5xx errors
        retry_strategy = Retry(
            total=5,  # Total number of retries
            backoff_factor=2,  # Wait 2^retry_count seconds between retries
            status_forcelist=[429, 500, 502, 503, 504],  # Retry on these HTTP codes
            allowed_methods=["GET"],  # Only retry GET requests
            raise_on_status=False  # Don't raise exception on max retries
        )
        
        # Mount adapter with retry strategy
        adapter = HTTPAdapter(
            max_retries=retry_strategy,
            pool_connections=20,  # Number of connection pools
            pool_maxsize=50  # Max connections per pool
        )
        self.session.mount("http://", adapter)
        self.session.mount("https://", adapter)
        
        # Set headers - BOE API requires Accept: application/xml for bloques
        self.session.headers.update({
            'User-Agent': 'BOE-RAG-Client/1.0',
            'Accept': 'application/xml',
            'Connection': 'keep-alive'
        })
    
    def list_normas(
        self, 
        from_date: Optional[date] = None,
        to_date: Optional[date] = None,
        offset: int = 0,
        limit: int = 100,
        query: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        Lista normas consolidadas filtradas por fecha de actualización.
        
        Args:
            from_date: Fecha inicio (fecha_actualizacion >= from_date)
            to_date: Fecha fin (fecha_actualizacion <= to_date)
            offset: Offset para paginación
            limit: Límite de resultados (-1 para todos)
            query: Consulta de texto opcional
            
        Returns:
            Lista de diccionarios con metadata de normas
        """
        # Real BOE API returns normas directly from base endpoint
        # The API structure is: GET {base_url} returns all normas
        # Not: GET {base_url}/normas (which doesn't exist)
        endpoint = self.base_url
        
        params = {}
        
        # BOE API uses 'from' and 'to' parameters (not fecha_actualizacion_desde/hasta)
        # Format dates as YYYYMMDD per BOE API format
        if from_date:
            params['from'] = from_date.strftime('%Y%m%d')
        if to_date:
            params['to'] = to_date.strftime('%Y%m%d')
        if query:
            params['query'] = query
        
        # Pagination parameters
        if offset > 0:
            params['offset'] = offset
        if limit != 100:  # Only add if different from default
            params['limit'] = limit
        
        try:
            logger.info(f"Fetching normas from {endpoint} with params: {params}")
            response = self.session.get(endpoint, params=params, timeout=self.timeout)
            response.raise_for_status()
            
            # Parse response (could be XML or JSON)
            content_type = response.headers.get('Content-Type', '')
            logger.info(f"Response content-type: {content_type}, status: {response.status_code}")
            
            # Try to parse as JSON first (most common)
            try:
                data = response.json()
                logger.info(f"Parsed JSON response, keys: {list(data.keys()) if isinstance(data, dict) else 'not a dict'}")
                return self._parse_normas_json(data)
            except ValueError as json_err:
                logger.warning(f"Failed to parse as JSON: {json_err}, trying XML")
                return self._parse_normas_xml(response.text)
                
        except requests.RequestException as e:
            logger.error(f"Error fetching normas: {e}")
            # Return empty list on error (don't crash DAG)
            return []
    
    def get_indice(self, id_norma: str) -> Dict[str, Any]:
        """
        Obtiene el índice de una norma (estructura de bloques).
        
        Args:
            id_norma: ID de la norma (e.g., 'BOE-A-2024-12345')
            
        Returns:
            Diccionario con:
                - id_norma
                - titulo
                - metadata
                - bloques: lista de bloques con fecha_actualizacion
        """
        # Use configurable template
        endpoint = self.indice_path_template.format(
            base=self.base_url,
            id_norma=id_norma
        )
        
        try:
            logger.info(f"Fetching indice for norma: {id_norma} from {endpoint}")
            response = self.session.get(endpoint, timeout=self.timeout)
            response.raise_for_status()
            
            content_type = response.headers.get('Content-Type', '')
            
            if 'json' in content_type:
                return self._parse_indice_json(response.json())
            elif 'xml' in content_type:
                return self._parse_indice_xml(response.text)
            else:
                return self._parse_indice_json(response.json())
        
        except requests.exceptions.ConnectionError as e:
            logger.error(f"Connection error fetching indice for {id_norma}: {e}")
            return {
                'id_norma': id_norma,
                'error': f'Connection error: {str(e)}',
                'error_type': 'connection',
                'bloques': []
            }
        except requests.exceptions.Timeout as e:
            logger.error(f"Timeout fetching indice for {id_norma}: {e}")
            return {
                'id_norma': id_norma,
                'error': f'Timeout: {str(e)}',
                'error_type': 'timeout',
                'bloques': []
            }
        except requests.exceptions.HTTPError as e:
            logger.error(f"HTTP error fetching indice for {id_norma}: {e}")
            return {
                'id_norma': id_norma,
                'error': f'HTTP {e.response.status_code}: {str(e)}',
                'error_type': 'http',
                'bloques': []
            }
        except requests.RequestException as e:
            logger.error(f"Error fetching indice for {id_norma}: {e}")
            # Return empty structure instead of crashing
            return {
                'id_norma': id_norma,
                'error': str(e),
                'error_type': 'unknown',
                'bloques': []
            }
    
    def get_bloque(self, id_norma: str, id_bloque: str) -> Dict[str, Any]:
        """
        Obtiene un bloque de una norma con todas sus versiones.
        
        Args:
            id_norma: ID de la norma
            id_bloque: ID del bloque (e.g., 'TITULO_I', 'ART_5')
            
        Returns:
            Diccionario con:
                - id_norma
                - id_bloque
                - tipo
                - titulo
                - versiones: lista de versiones con:
                    - id_norma_modificadora
                    - fecha_publicacion_mod
                    - fecha_vigencia_desde
                    - html (contenido HTML)
        """
        # Use configurable template
        endpoint = self.bloque_path_template.format(
            base=self.base_url,
            id_norma=id_norma,
            id_bloque=id_bloque
        )
        
        try:
            logger.info(f"Fetching bloque: {id_norma}/{id_bloque} from {endpoint}")
            response = self.session.get(endpoint, timeout=self.timeout)
            response.raise_for_status()
            
            # BOE API only returns XML for bloques (JSON not supported)
            return self._parse_bloque_xml(response.text)
        
        except requests.exceptions.ConnectionError as e:
            logger.error(f"Connection error fetching bloque {id_norma}/{id_bloque}: {e}")
            return {
                'id_norma': id_norma,
                'id_bloque': id_bloque,
                'error': f'Connection error: {str(e)}',
                'error_type': 'connection',
                'versiones': []
            }
        except requests.exceptions.Timeout as e:
            logger.error(f"Timeout fetching bloque {id_norma}/{id_bloque}: {e}")
            return {
                'id_norma': id_norma,
                'id_bloque': id_bloque,
                'error': f'Timeout: {str(e)}',
                'error_type': 'timeout',
                'versiones': []
            }
        except requests.HTTPError as e:
            # Distinguish between different HTTP errors
            if e.response.status_code == 400:
                logger.debug(f"Bloque {id_norma}/{id_bloque} not available via API (400 Bad Request)")
            elif e.response.status_code == 404:
                logger.warning(f"Bloque {id_norma}/{id_bloque} not found (404)")
            else:
                logger.error(f"HTTP error fetching bloque {id_norma}/{id_bloque}: {e}")
            
            return {
                'id_norma': id_norma,
                'id_bloque': id_bloque,
                'error': str(e),
                'error_code': e.response.status_code if hasattr(e, 'response') else None,
                'error_type': 'http',
                'versiones': []
            }
        except requests.RequestException as e:
            logger.error(f"Error fetching bloque {id_norma}/{id_bloque}: {e}")
            # Return empty structure instead of crashing
            return {
                'id_norma': id_norma,
                'id_bloque': id_bloque,
                'error': str(e),
                'error_type': 'unknown',
                'versiones': []
            }
    
    # =========================================================================
    # Parsing helpers (XML/JSON)
    # =========================================================================
    
    def _parse_normas_json(self, data: Dict) -> List[Dict[str, Any]]:
        """Parse JSON response from list_normas.
        
        Real API response structure:
        {
            "status": {"code": "200", "text": "OK"},
            "data": [
                {
                    "identificador": "BOE-A-2015-10566",
                    "titulo": "...",
                    "fecha_actualizacion": "20240115T120000Z",
                    "fecha_publicacion": "20150930",
                    "fecha_disposicion": "20150930",
                    "fecha_vigencia": "20151030",
                    "rango": {"codigo": "...", "texto": "..."},
                    "departamento": {"codigo": "...", "texto": "..."},
                    "ambito": {"codigo": "...", "texto": "..."},
                    "url_html_consolidada": "...",
                    "url_eli": "..."
                }
            ]
        }
        """
        normas = []
        
        # Get items from 'data' key (real API structure)
        items = data.get('data', [])
        
        # Handle data as object or list - normalize to list
        if isinstance(items, dict):
            items = [items]
        elif not isinstance(items, list):
            items = []
        
        # Fallback to legacy structure if 'data' not found
        if not items:
            items = data.get('items', []) or data.get('normas', [])
            if isinstance(items, dict):
                items = [items]
        
        logger.info(f"Parsing {len(items)} normas from JSON response")
        
        for item in items:
            try:
                # Extract nested objects with tolerance
                rango_obj = item.get('rango', {})
                if isinstance(rango_obj, dict):
                    rango = rango_obj.get('texto')
                    rango_codigo = rango_obj.get('codigo')
                else:
                    rango = rango_obj  # String fallback
                    rango_codigo = None
                
                departamento_obj = item.get('departamento', {})
                if isinstance(departamento_obj, dict):
                    departamento = departamento_obj.get('texto')
                else:
                    departamento = departamento_obj or item.get('organismo')
                
                ambito_obj = item.get('ambito', {})
                if isinstance(ambito_obj, dict):
                    ambito = ambito_obj.get('texto', 'Estatal')
                else:
                    ambito = ambito_obj or 'Estatal'
                
                # Parse dates with new format support
                fecha_publicacion = self._parse_date(item.get('fecha_publicacion'))
                fecha_disposicion = self._parse_date(item.get('fecha_disposicion'))
                fecha_vigencia = self._parse_date(item.get('fecha_vigencia'))
                fecha_actualizacion_api = self._parse_datetime(item.get('fecha_actualizacion'))
                
                # Build norma dict
                norma = {
                    'id_norma': item.get('identificador') or item.get('id'),
                    'titulo': item.get('titulo') or item.get('title'),
                    'rango': rango,
                    'departamento': departamento,
                    'ambito': ambito,
                    'fecha_publicacion': fecha_publicacion,
                    'fecha_disposicion': fecha_disposicion,
                    'url_html_consolidada': item.get('url_html_consolidada') or item.get('url_html') or item.get('url'),
                    'url_eli': item.get('url_eli'),
                    'fecha_actualizacion_api': fecha_actualizacion_api,
                    'metadata': item  # Store full item for reference
                }
                
                # Only add if we have a valid id_norma
                if norma['id_norma']:
                    normas.append(norma)
                else:
                    logger.warning(f"Skipping norma without identificador: {item}")
                    
            except Exception as e:
                logger.error(f"Error parsing norma item: {e}, item: {item}")
                continue
        
        logger.info(f"Successfully parsed {len(normas)} valid normas")
        return normas
    
    def _parse_normas_xml(self, xml_text: str) -> List[Dict[str, Any]]:
        """Parse XML response from list_normas.
        
        Actual BOE API structure:
        <response>
          <status><code>200</code></status>
          <data>
            <item>
              <identificador>BOE-A-2025-26458</identificador>
              <titulo>Real Decreto-ley...</titulo>
              <rango codigo="1320">Real Decreto-ley</rango>
              <departamento codigo="7723">Jefatura del Estado</departamento>
              <ambito codigo="1">Estatal</ambito>
              <fecha_publicacion>20251224</fecha_publicacion>
              <fecha_disposicion>20251223</fecha_disposicion>
              <url_html_consolidada>https://...</url_html_consolidada>
              <url_eli>https://...</url_eli>
              <fecha_actualizacion>20260130T124315Z</fecha_actualizacion>
            </item>
          </data>
        </response>
        """
        normas = []
        
        try:
            root = ET.fromstring(xml_text)
            
            # Check status code
            status_code = root.findtext('.//status/code')
            if status_code != '200':
                error_text = root.findtext('.//status/text', 'Unknown error')
                logger.error(f"API returned error status {status_code}: {error_text}")
                return []
            
            # Navigate to data section and find all items
            data_elem = root.find('.//data')
            if data_elem is None:
                logger.warning("No <data> element found in XML response")
                return []
            
            # Each norma is an <item> element
            for item_elem in data_elem.findall('item'):
                # Extract text content, handling elements with attributes
                ambito_elem = item_elem.find('ambito')
                ambito = ambito_elem.text if ambito_elem is not None else 'Estatal'
                
                departamento_elem = item_elem.find('departamento')
                departamento = departamento_elem.text if departamento_elem is not None else None
                
                rango_elem = item_elem.find('rango')
                rango = rango_elem.text if rango_elem is not None else None
                
                norma = {
                    'id_norma': item_elem.findtext('identificador'),
                    'titulo': item_elem.findtext('titulo'),
                    'rango': rango,
                    'departamento': departamento,
                    'ambito': ambito,
                    'fecha_publicacion': self._parse_date(item_elem.findtext('fecha_publicacion')),
                    'fecha_disposicion': self._parse_date(item_elem.findtext('fecha_disposicion')),
                    'url_html_consolidada': item_elem.findtext('url_html_consolidada'),
                    'url_eli': item_elem.findtext('url_eli'),
                    'fecha_actualizacion_api': self._parse_datetime(
                        item_elem.findtext('fecha_actualizacion')
                    ),
                    'metadata': {}
                }
                
                # Only add normas with valid id_norma
                if norma['id_norma']:
                    normas.append(norma)
                else:
                    logger.warning(f"Skipping item without identificador: {item_elem.findtext('titulo')}")
                    
        except ET.ParseError as e:
            logger.error(f"XML parse error: {e}")
            logger.error(f"First 500 chars of XML: {xml_text[:500]}")
        except Exception as e:
            logger.error(f"Unexpected error parsing normas XML: {e}")
            logger.error(f"First 500 chars of XML: {xml_text[:500]}")
        
        return normas
    
    def _parse_indice_json(self, data: Dict) -> Dict[str, Any]:
        """Parse JSON response from get_indice.
        
        Real API may return:
        1. {"status": {...}, "data": {...}} - single object
        2. {"status": {...}, "data": [{...}]} - array with single object
        3. {"bloques": [...]} - legacy direct format
        """
        bloques = []
        
        # Extract the actual data from response
        actual_data = data
        if 'data' in data:
            data_content = data['data']
            # Handle data as list or single object
            if isinstance(data_content, list) and len(data_content) > 0:
                actual_data = data_content[0]
            elif isinstance(data_content, dict):
                actual_data = data_content
        
        # Extract bloques array - try multiple possible keys
        # Check for None explicitly to allow empty lists to be returned
        bloques_list = actual_data.get('bloques')
        if bloques_list is None:
            bloques_list = actual_data.get('bloque')  # BOE API uses singular 'bloque'
        if bloques_list is None:
            bloques_list = actual_data.get('estructura')
        if bloques_list is None:
            bloques_list = actual_data.get('indice')
        if bloques_list is None:
            bloques_list = []
        
        # If actual_data is a list itself, treat it as bloques list
        if not bloques_list and isinstance(actual_data, list):
            bloques_list = actual_data
        
        for bloque_item in bloques_list:
            try:
                # Extract tipo - can be dict or string
                tipo_obj = bloque_item.get('tipo')
                if isinstance(tipo_obj, dict):
                    tipo = tipo_obj.get('texto') or tipo_obj.get('codigo')
                else:
                    tipo = tipo_obj
                
                bloque = {
                    'id_bloque': bloque_item.get('id') or bloque_item.get('identificador'),
                    'tipo': tipo,
                    'titulo_bloque': bloque_item.get('titulo'),
                    'fecha_actualizacion_bloque': self._parse_datetime(
                        bloque_item.get('fecha_actualizacion')
                    ),
                    'url_bloque': bloque_item.get('url')
                }
                # Only add if we have an id_bloque
                if bloque['id_bloque']:
                    bloques.append(bloque)
                else:
                    logger.warning(f"Skipping bloque without id: {bloque_item}")
            except Exception as e:
                logger.error(f"Error parsing bloque item: {e}, item: {bloque_item}")
                continue
        
        return {
            'id_norma': actual_data.get('id_norma') or actual_data.get('identificador'),
            'titulo': actual_data.get('titulo'),
            'metadata': data,
            'bloques': bloques
        }
    
    def _parse_indice_xml(self, xml_text: str) -> Dict[str, Any]:
        """Parse XML response from get_indice.
        
        Actual BOE API structure:
        <response>
          <status><code>200</code></status>
          <data>
            <bloque>
              <id>no</id>
              <titulo>[titulo]</titulo>
              <fecha_actualizacion>20260128</fecha_actualizacion>
              <url>https://...</url>
            </bloque>
          </data>
        </response>
        
        Note: id_norma is not in the response, it's passed by the caller.
        """
        bloques = []
        id_norma = None
        titulo = None
        
        try:
            root = ET.fromstring(xml_text)
            
            # Check status code
            status_code = root.findtext('.//status/code')
            if status_code != '200':
                error_text = root.findtext('.//status/text', 'Unknown error')
                logger.error(f"API returned error status {status_code}: {error_text}")
                return {'bloques': []}
            
            # Navigate to data section
            data_elem = root.find('.//data')
            if data_elem is None:
                logger.warning("No <data> element found in indice XML response")
                return {'bloques': []}
            
            # Each bloque is directly under data
            for bloque_elem in data_elem.findall('bloque'):
                # Note: 'tipo' is not provided in the indice response, 
                # it will need to be inferred or left null
                id_bloque = bloque_elem.findtext('id')
                if not id_bloque:
                    continue
                
                bloque = {
                    'id_bloque': id_bloque,
                    'tipo': None,  # Not provided in indice response
                    'titulo_bloque': bloque_elem.findtext('titulo'),
                    'fecha_actualizacion_bloque': self._parse_datetime(
                        bloque_elem.findtext('fecha_actualizacion')
                    ),
                    'url_bloque': bloque_elem.findtext('url')
                }
                bloques.append(bloque)
            
            return {
                'id_norma': id_norma,  # Will be set by caller
                'titulo': titulo,       # Not in response
                'metadata': {},
                'bloques': bloques
            }
        except ET.ParseError as e:
            logger.error(f"XML parse error in indice: {e}")
            logger.error(f"First 500 chars of XML: {xml_text[:500]}")
            return {'bloques': []}
        except Exception as e:
            logger.error(f"Unexpected error parsing indice XML: {e}")
            logger.error(f"First 500 chars of XML: {xml_text[:500]}")
            return {'bloques': []}
    
    def _parse_bloque_json(self, data: Dict) -> Dict[str, Any]:
        """Parse JSON response from get_bloque.
        
        Real API may return:
        1. {"status": {...}, "data": {...}} - single object
        2. {"status": {...}, "data": [{...}]} - array with single object
        3. {"versiones": [...]} - legacy direct format
        """
        versiones = []
        
        # Extract the actual data from response
        actual_data = data
        if 'data' in data:
            data_content = data['data']
            # Handle data as list or single object
            if isinstance(data_content, list) and len(data_content) > 0:
                actual_data = data_content[0]
            elif isinstance(data_content, dict):
                actual_data = data_content
        
        # Extract versiones array - try multiple possible keys
        # Check for None explicitly to allow empty lists to be returned
        versiones_list = actual_data.get('versiones')
        if versiones_list is None:
            versiones_list = actual_data.get('historico')
        if versiones_list is None:
            versiones_list = actual_data.get('versions')
        if versiones_list is None:
            versiones_list = []
        
        # If actual_data is a list itself, treat it as versiones list
        if not versiones_list and isinstance(actual_data, list):
            versiones_list = actual_data
        
        # Normalize versiones_list to list if it's a dict
        if isinstance(versiones_list, dict):
            versiones_list = [versiones_list]
        
        for version_item in versiones_list:
            try:
                version = {
                    'id_norma_modificadora': version_item.get('id_norma_modificadora'),
                    'fecha_publicacion_mod': self._parse_date(
                        version_item.get('fecha_publicacion_mod') or version_item.get('fecha_publicacion')
                    ),
                    'fecha_vigencia_desde': self._parse_date(
                        version_item.get('fecha_vigencia_desde') or version_item.get('fecha_vigencia')
                    ),
                    'html': (version_item.get('contenido_html') or 
                            version_item.get('html') or 
                            version_item.get('contenido') or 
                            version_item.get('texto'))
                }
                # Only add versions with content
                if version['html']:
                    versiones.append(version)
                else:
                    logger.warning(f"Skipping version without content: {version_item.get('id_norma_modificadora')}")
            except Exception as e:
                logger.error(f"Error parsing version item: {e}, item: {version_item}")
                continue
        
        return {
            'id_norma': actual_data.get('id_norma') or actual_data.get('identificador'),
            'id_bloque': actual_data.get('id_bloque') or actual_data.get('identificador_bloque'),
            'tipo': actual_data.get('tipo'),
            'titulo': actual_data.get('titulo'),
            'versiones': versiones
        }
    
    def _parse_bloque_xml(self, xml_text: str) -> Dict[str, Any]:
        """Parse XML response from get_bloque.
        
        Real BOE API structure:
        <response>
          <status><code>200</code></status>
          <data>
            <bloque id="..." tipo="...">
              <version id_norma="..." fecha_publicacion="..." fecha_vigencia="...">
                <p>HTML content</p>
              </version>
            </bloque>
          </data>
        </response>
        """
        versiones = []
        id_norma = None
        id_bloque = None
        tipo = None
        
        try:
            root = ET.fromstring(xml_text)
            
            # Check for error response
            status_code = root.findtext('.//status/code')
            if status_code != '200':
                error_text = root.findtext('.//status/text', 'Unknown error')
                logger.error(f"BOE API error: {status_code} - {error_text}")
                return {'versiones': [], 'error': error_text}
            
            # Get bloque element
            bloque_elem = root.find('.//data/bloque')
            if bloque_elem is None:
                logger.warning("No bloque element found in XML")
                return {'versiones': []}
            
            # Get bloque attributes
            id_bloque = bloque_elem.get('id')
            tipo = bloque_elem.get('tipo')
            
            # Parse versions
            for version_elem in bloque_elem.findall('version'):
                id_norma_mod = version_elem.get('id_norma')
                fecha_pub = version_elem.get('fecha_publicacion')
                fecha_vig = version_elem.get('fecha_vigencia')
                
                # Extract all HTML content from version element
                # Convert entire version element to string, removing the version tag itself
                html_content = ET.tostring(version_elem, encoding='unicode', method='html')
                # Remove version tag wrapper
                html_content = html_content.replace(f'<version id_norma="{id_norma_mod}" fecha_publicacion="{fecha_pub}" fecha_vigencia="{fecha_vig}">', '')
                html_content = html_content.replace('</version>', '')
                html_content = html_content.strip()
                
                version = {
                    'id_norma_modificadora': id_norma_mod,
                    'fecha_publicacion_mod': self._parse_date(fecha_pub),
                    'fecha_vigencia_desde': self._parse_date(fecha_vig),
                    'html': html_content
                }
                
                # Set id_norma from first version if not set
                if id_norma is None:
                    id_norma = id_norma_mod
                
                versiones.append(version)
            
            return {
                'id_norma': id_norma,
                'id_bloque': id_bloque,
                'tipo': tipo,
                'versiones': versiones
            }
        except ET.ParseError as e:
            logger.error(f"XML parse error: {e}")
            logger.debug(f"XML content: {xml_text[:500]}")
            return {'versiones': [], 'error': f'XML parse error: {str(e)}'}
        except Exception as e:
            logger.error(f"Unexpected error parsing bloque XML: {e}")
            return {'versiones': [], 'error': f'Unexpected error: {str(e)}'}

    
    # =========================================================================
    # Helper methods
    # =========================================================================
    
    def _parse_date(self, date_str: Optional[str]) -> Optional[date]:
        """Parse date string to date object.
        
        Supports multiple formats:
        - YYYYMMDD (BOE format)
        - YYYY-MM-DD (ISO format)
        - ISO 8601 with time
        """
        if not date_str:
            return None
        
        # Strip whitespace
        date_str = str(date_str).strip()
        
        # Try YYYYMMDD format first (BOE API format)
        if len(date_str) == BOE_DATE_FORMAT_LENGTH and date_str.isdigit():
            try:
                return datetime.strptime(date_str, '%Y%m%d').date()
            except (ValueError, TypeError) as e:
                logger.debug(f"Failed to parse date as YYYYMMDD: {date_str}, {e}")
        
        # Try YYYY-MM-DD format
        try:
            return datetime.strptime(date_str, '%Y-%m-%d').date()
        except (ValueError, TypeError):
            pass
        
        # Try ISO format with time
        try:
            return datetime.fromisoformat(date_str.replace('Z', '+00:00')).date()
        except Exception:
            pass
        
        logger.warning(f"Could not parse date: {date_str}")
        return None
    
    def _parse_datetime(self, dt_str: Optional[str]) -> Optional[datetime]:
        """Parse datetime string to datetime object.
        
        Supports multiple formats:
        - YYYYMMDD (BOE date format - converted to datetime at midnight)
        - YYYYMMDDTHHMMSSZ (BOE datetime format)
        - ISO 8601
        - YYYY-MM-DD HH:MM:SS
        """
        if not dt_str:
            return None
        
        # Strip whitespace
        dt_str = str(dt_str).strip()
        
        # Try YYYYMMDD format first (BOE API date-only format)
        # Example: 19910301 -> 1991-03-01 00:00:00
        if len(dt_str) == BOE_DATE_FORMAT_LENGTH and dt_str.isdigit():
            try:
                return datetime.strptime(dt_str, '%Y%m%d')
            except (ValueError, TypeError) as e:
                logger.debug(f"Failed to parse datetime as YYYYMMDD: {dt_str}, {e}")
        
        # Try YYYYMMDDTHHMMSSZ format (BOE API datetime format)
        # Example: 20240115T120000Z
        if 'T' in dt_str and dt_str.endswith('Z'):
            try:
                return datetime.strptime(dt_str, '%Y%m%dT%H%M%SZ')
            except (ValueError, TypeError) as e:
                logger.debug(f"Failed to parse datetime as YYYYMMDDTHHMMSSZ: {dt_str}, {e}")
        
        # Try ISO format
        try:
            # Handle Z suffix
            iso_str = dt_str.replace('Z', '+00:00')
            return datetime.fromisoformat(iso_str)
        except Exception:
            pass
        
        # Try YYYY-MM-DD HH:MM:SS format
        try:
            return datetime.strptime(dt_str, '%Y-%m-%d %H:%M:%S')
        except Exception:
            pass
        
        logger.warning(f"Could not parse datetime: {dt_str}")
        return None


def get_client() -> BOEConsolidadaClient:
    """Get a configured BOE Consolidada client instance."""
    return BOEConsolidadaClient()
