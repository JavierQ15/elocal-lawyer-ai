"""
Cliente para la API de Legislación Consolidada del BOE.
API Docs: https://www.boe.es/datosabiertos/documentacion/legislacion-consolidada

Este módulo NO hace scraping HTML. Usa la API oficial del BOE para:
- Listar normas consolidadas
- Obtener índice de una norma
- Obtener bloques con versiones
"""
import os
import requests
from datetime import datetime, date
from typing import Dict, List, Optional, Any
import xml.etree.ElementTree as ET
import json
import logging

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
    '{base}/{id_norma}/indice'
)
BOE_CONSOLIDADA_BLOQUE_PATH_TEMPLATE = os.getenv(
    'BOE_CONSOLIDADA_BLOQUE_PATH_TEMPLATE',
    '{base}/{id_norma}/bloques/{id_bloque}'
)


class BOEConsolidadaClient:
    """Cliente para interactuar con la API de Legislación Consolidada del BOE."""
    
    def __init__(self, base_url: str = BOE_CONSOLIDADA_BASE_URL, timeout: int = BOE_API_TIMEOUT):
        self.base_url = base_url
        self.timeout = timeout
        self.indice_path_template = BOE_CONSOLIDADA_INDICE_PATH_TEMPLATE
        self.bloque_path_template = BOE_CONSOLIDADA_BLOQUE_PATH_TEMPLATE
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'BOE-RAG-Client/1.0',
            'Accept': 'application/xml, application/json'
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
        
        # Try to support filtering if API accepts it
        # Format dates as YYYYMMDD per BOE API format
        if from_date:
            params['fecha_actualizacion_desde'] = from_date.strftime('%Y%m%d')
        if to_date:
            params['fecha_actualizacion_hasta'] = to_date.strftime('%Y%m%d')
        if query:
            params['q'] = query
        
        # Note: BOE API may not support pagination parameters
        # We include them but the API may ignore them
        if offset > 0:
            params['offset'] = offset
        if limit > 0 and limit != 100:
            params['limit'] = limit
        
        try:
            logger.info(f"Fetching normas from {endpoint} with params: {params}")
            response = self.session.get(endpoint, params=params, timeout=self.timeout)
            response.raise_for_status()
            
            # Parse response (could be XML or JSON)
            content_type = response.headers.get('Content-Type', '')
            
            if 'json' in content_type:
                return self._parse_normas_json(response.json())
            elif 'xml' in content_type:
                return self._parse_normas_xml(response.text)
            else:
                logger.warning(f"Unknown content type: {content_type}, trying JSON")
                return self._parse_normas_json(response.json())
                
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
                
        except requests.RequestException as e:
            logger.error(f"Error fetching indice for {id_norma}: {e}")
            # Return empty structure instead of crashing
            return {
                'id_norma': id_norma,
                'error': str(e),
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
            
            content_type = response.headers.get('Content-Type', '')
            
            if 'json' in content_type:
                return self._parse_bloque_json(response.json())
            elif 'xml' in content_type:
                return self._parse_bloque_xml(response.text)
            else:
                return self._parse_bloque_json(response.json())
                
        except requests.RequestException as e:
            logger.error(f"Error fetching bloque {id_norma}/{id_bloque}: {e}")
            # Return empty structure instead of crashing
            return {
                'id_norma': id_norma,
                'id_bloque': id_bloque,
                'error': str(e),
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
        
        # Fallback to legacy structure if 'data' not found
        if not items:
            items = data.get('items', []) or data.get('normas', [])
        
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
        """Parse XML response from list_normas."""
        # TODO: Adapt to real BOE API XML structure
        normas = []
        
        try:
            root = ET.fromstring(xml_text)
            
            for norma_elem in root.findall('.//norma'):
                norma = {
                    'id_norma': norma_elem.findtext('identificador'),
                    'titulo': norma_elem.findtext('titulo'),
                    'rango': norma_elem.findtext('rango'),
                    'departamento': norma_elem.findtext('departamento'),
                    'ambito': norma_elem.findtext('ambito', 'Estatal'),
                    'fecha_publicacion': self._parse_date(norma_elem.findtext('fecha_publicacion')),
                    'fecha_disposicion': self._parse_date(norma_elem.findtext('fecha_disposicion')),
                    'url_html_consolidada': norma_elem.findtext('url_html'),
                    'url_eli': norma_elem.findtext('url_eli'),
                    'fecha_actualizacion_api': self._parse_datetime(
                        norma_elem.findtext('fecha_actualizacion')
                    ),
                    'metadata': {}
                }
                normas.append(norma)
        except ET.ParseError as e:
            logger.error(f"XML parse error: {e}")
        
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
        
        # Extract bloques array
        bloques_list = actual_data.get('bloques', []) or actual_data.get('estructura', [])
        
        for bloque_item in bloques_list:
            try:
                bloque = {
                    'id_bloque': bloque_item.get('id') or bloque_item.get('identificador'),
                    'tipo': bloque_item.get('tipo'),
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
        """Parse XML response from get_indice."""
        # TODO: Adapt to real BOE API XML structure
        bloques = []
        
        try:
            root = ET.fromstring(xml_text)
            id_norma = root.findtext('identificador')
            titulo = root.findtext('titulo')
            
            for bloque_elem in root.findall('.//bloque'):
                bloque = {
                    'id_bloque': bloque_elem.findtext('identificador'),
                    'tipo': bloque_elem.findtext('tipo'),
                    'titulo_bloque': bloque_elem.findtext('titulo'),
                    'fecha_actualizacion_bloque': self._parse_datetime(
                        bloque_elem.findtext('fecha_actualizacion')
                    ),
                    'url_bloque': bloque_elem.findtext('url')
                }
                bloques.append(bloque)
            
            return {
                'id_norma': id_norma,
                'titulo': titulo,
                'metadata': {},
                'bloques': bloques
            }
        except ET.ParseError as e:
            logger.error(f"XML parse error: {e}")
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
        
        # Extract versiones array
        versiones_list = actual_data.get('versiones', [])
        
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
                    'html': version_item.get('contenido_html') or version_item.get('html') or version_item.get('texto')
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
        """Parse XML response from get_bloque."""
        # TODO: Adapt to real BOE API XML structure
        versiones = []
        
        try:
            root = ET.fromstring(xml_text)
            
            for version_elem in root.findall('.//version'):
                version = {
                    'id_norma_modificadora': version_elem.findtext('id_norma_modificadora'),
                    'fecha_publicacion_mod': self._parse_date(
                        version_elem.findtext('fecha_publicacion_mod')
                    ),
                    'fecha_vigencia_desde': self._parse_date(
                        version_elem.findtext('fecha_vigencia_desde')
                    ),
                    'html': version_elem.findtext('contenido_html')
                }
                versiones.append(version)
            
            return {
                'id_norma': root.findtext('id_norma'),
                'id_bloque': root.findtext('id_bloque'),
                'tipo': root.findtext('tipo'),
                'titulo': root.findtext('titulo'),
                'versiones': versiones
            }
        except ET.ParseError as e:
            logger.error(f"XML parse error: {e}")
            return {'versiones': []}
    
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
        - YYYYMMDDTHHMMSSZ (BOE format)
        - ISO 8601
        - YYYY-MM-DD HH:MM:SS
        """
        if not dt_str:
            return None
        
        # Strip whitespace
        dt_str = str(dt_str).strip()
        
        # Try YYYYMMDDTHHMMSSZ format first (BOE API format)
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
