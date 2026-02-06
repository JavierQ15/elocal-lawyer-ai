# BOE API Integration

This document provides information on how to integrate with the BOE (Boletín Oficial del Estado) API.

## Official BOE Data Sources

The BOE provides open data through various channels:

### 1. BOE Open Data Portal
- URL: https://www.boe.es/datosabiertos/
- Formats: XML, JSON
- Documentation: https://www.boe.es/datosabiertos/documentacion/

### 2. BOE Web Services
- SOAP Web Services for accessing BOE content
- Documentation available on the official website

### 3. RSS Feeds
- Daily summaries
- Section-specific feeds

## Implementation Notes

The current implementation in `airflow/dags/utils/boe_scraper.py` is a **placeholder**.

To implement real BOE integration:

1. **Register for BOE API access** (if required)
2. **Implement XML/JSON parsing** for BOE data structures
3. **Add authentication** if needed
4. **Implement rate limiting** to respect API limits
5. **Add error handling** for API failures

## Example BOE API Usage

```python
import requests
import xml.etree.ElementTree as ET

def fetch_boe_summary(date):
    """
    Fetch BOE summary for a specific date.
    
    Args:
        date: Date in format YYYYMMDD
        
    Returns:
        Parsed BOE data
    """
    url = f"https://www.boe.es/diario_boe/xml.php?id=BOE-S-{date}"
    response = requests.get(url)
    response.raise_for_status()
    
    # Parse XML
    root = ET.fromstring(response.content)
    
    # Extract documents
    documents = []
    for item in root.findall('.//item'):
        doc = {
            'boe_id': item.find('identificador').text,
            'title': item.find('titulo').text,
            'url': item.find('url').text,
            # ... more fields
        }
        documents.append(doc)
    
    return documents
```

## Data Structure

BOE documents typically contain:

- **Identificador**: Unique BOE identifier (e.g., BOE-A-2024-12345)
- **Título**: Document title
- **Fecha de publicación**: Publication date
- **Sección**: BOE section (I, II, III, IV, V)
- **Departamento**: Issuing department
- **Rango**: Document type (Ley, Real Decreto, Orden, etc.)
- **Texto**: Full text content
- **PDF URL**: Link to PDF version

## Recommended Approach

For production use, consider:

1. **Using official BOE XML feeds** for reliability
2. **Implementing proper caching** to avoid repeated downloads
3. **Storing raw XML/JSON** alongside processed data
4. **Monitoring BOE website changes** that might affect scraping
5. **Implementing backoff strategies** for failed requests

## Legal Considerations

- BOE data is public domain in Spain
- Respect BOE's terms of service
- Implement appropriate attribution
- Don't overload BOE servers with requests

## References

- BOE Open Data: https://www.boe.es/datosabiertos/
- BOE: https://www.boe.es
