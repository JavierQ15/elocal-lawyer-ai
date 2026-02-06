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

BOE_CONSOLIDADA_BASE_URL = os.getenv(
    'BOE_CONSOLIDADA_BASE_URL', 
    'https://www.boe.es/datosabiertos/api/legislacion'
)
BOE_API_TIMEOUT = int(os.getenv('BOE_API_TIMEOUT', '30'))


class BOEConsolidadaClient:
    """Cliente para interactuar con la API de Legislación Consolidada del BOE."""
    
    def __init__(self, base_url: str = BOE_CONSOLIDADA_BASE_URL, timeout: int = BOE_API_TIMEOUT):
        self.base_url = base_url
        self.timeout = timeout
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
        endpoint = f"{self.base_url}/normas"
        
        params = {
            'offset': offset,
            'limit': limit if limit > 0 else 10000
        }
        
        if from_date:
            params['fecha_actualizacion_desde'] = from_date.isoformat()
        if to_date:
            params['fecha_actualizacion_hasta'] = to_date.isoformat()
        if query:
            params['q'] = query
        
        try:
            logger.info(f"Fetching normas: offset={offset}, limit={limit}")
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
            # Return empty list for demo, in production you'd raise or retry
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
        endpoint = f"{self.base_url}/normas/{id_norma}/indice"
        
        try:
            logger.info(f"Fetching indice for norma: {id_norma}")
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
        endpoint = f"{self.base_url}/normas/{id_norma}/bloques/{id_bloque}"
        
        try:
            logger.info(f"Fetching bloque: {id_norma}/{id_bloque}")
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
        """Parse JSON response from list_normas."""
        # TODO: Adapt to real BOE API JSON structure
        # For now, return mock structure
        normas = []
        
        items = data.get('items', []) or data.get('normas', [])
        for item in items:
            norma = {
                'id_norma': item.get('id') or item.get('identificador'),
                'titulo': item.get('titulo') or item.get('title'),
                'rango': item.get('rango'),
                'departamento': item.get('departamento') or item.get('organismo'),
                'ambito': item.get('ambito', 'Estatal'),
                'fecha_publicacion': self._parse_date(item.get('fecha_publicacion')),
                'fecha_disposicion': self._parse_date(item.get('fecha_disposicion')),
                'url_html_consolidada': item.get('url_html') or item.get('url'),
                'url_eli': item.get('url_eli'),
                'fecha_actualizacion_api': self._parse_datetime(
                    item.get('fecha_actualizacion') or item.get('last_modified')
                ),
                'metadata': item
            }
            normas.append(norma)
        
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
        """Parse JSON response from get_indice."""
        # TODO: Adapt to real BOE API JSON structure
        bloques = []
        
        for bloque_item in data.get('bloques', []) or data.get('estructura', []):
            bloque = {
                'id_bloque': bloque_item.get('id') or bloque_item.get('identificador'),
                'tipo': bloque_item.get('tipo'),
                'titulo_bloque': bloque_item.get('titulo'),
                'fecha_actualizacion_bloque': self._parse_datetime(
                    bloque_item.get('fecha_actualizacion')
                ),
                'url_bloque': bloque_item.get('url')
            }
            bloques.append(bloque)
        
        return {
            'id_norma': data.get('id_norma') or data.get('identificador'),
            'titulo': data.get('titulo'),
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
        """Parse JSON response from get_bloque."""
        # TODO: Adapt to real BOE API JSON structure
        versiones = []
        
        for version_item in data.get('versiones', []):
            version = {
                'id_norma_modificadora': version_item.get('id_norma_modificadora'),
                'fecha_publicacion_mod': self._parse_date(
                    version_item.get('fecha_publicacion_mod')
                ),
                'fecha_vigencia_desde': self._parse_date(
                    version_item.get('fecha_vigencia_desde')
                ),
                'html': version_item.get('contenido_html') or version_item.get('html')
            }
            versiones.append(version)
        
        return {
            'id_norma': data.get('id_norma'),
            'id_bloque': data.get('id_bloque'),
            'tipo': data.get('tipo'),
            'titulo': data.get('titulo'),
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
        """Parse date string to date object."""
        if not date_str:
            return None
        try:
            return datetime.strptime(date_str, '%Y-%m-%d').date()
        except (ValueError, TypeError):
            try:
                return datetime.fromisoformat(date_str).date()
            except:
                return None
    
    def _parse_datetime(self, dt_str: Optional[str]) -> Optional[datetime]:
        """Parse datetime string to datetime object."""
        if not dt_str:
            return None
        try:
            return datetime.fromisoformat(dt_str)
        except:
            try:
                return datetime.strptime(dt_str, '%Y-%m-%d %H:%M:%S')
            except:
                return None


def get_client() -> BOEConsolidadaClient:
    """Get a configured BOE Consolidada client instance."""
    return BOEConsolidadaClient()
