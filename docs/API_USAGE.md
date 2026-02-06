# API Usage Examples

This document provides examples of using the BOE Legislation RAG API.

## Base URL

```
http://localhost:8000
```

In production, replace with your domain:
```
https://your-domain.com/api
```

## Interactive Documentation

The API provides interactive Swagger documentation:
- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc

## Authentication

Currently, the API does not require authentication. For production, implement JWT or API key authentication.

## Endpoints

### 1. Health Check

Check if all services are operational.

**Request:**
```bash
curl -X GET "http://localhost:8000/health"
```

**Response:**
```json
{
  "status": "healthy",
  "services": {
    "api": "healthy",
    "postgres": "healthy",
    "qdrant": "healthy",
    "ollama": "healthy"
  }
}
```

### 2. RAG Query

Ask questions about BOE legislation and get AI-generated answers with sources.

**Request:**
```bash
curl -X POST "http://localhost:8000/query" \
  -H "Content-Type: application/json" \
  -d '{
    "question": "¿Qué dice la legislación sobre protección de datos?",
    "max_results": 5,
    "temperature": 0.7
  }'
```

**Response:**
```json
{
  "answer": "Basándome en la legislación del BOE proporcionada, la protección de datos personales está regulada por...",
  "sources": [
    {
      "boe_id": "BOE-A-2024-12345",
      "title": "Ley Orgánica de Protección de Datos",
      "chunk_text": "Los datos personales gozarán de protección...",
      "score": 0.89,
      "publication_date": "2024-01-15",
      "url": "https://www.boe.es/..."
    }
  ],
  "query": "¿Qué dice la legislación sobre protección de datos?"
}
```

**Python Example:**
```python
import requests

url = "http://localhost:8000/query"
payload = {
    "question": "¿Qué dice la legislación sobre protección de datos?",
    "max_results": 5,
    "temperature": 0.7
}

response = requests.post(url, json=payload)
result = response.json()

print("Answer:", result["answer"])
print(f"\nFound {len(result['sources'])} sources:")
for source in result["sources"]:
    print(f"- {source['title']} (Score: {source['score']:.2f})")
```

**JavaScript Example:**
```javascript
const response = await fetch('http://localhost:8000/query', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    question: '¿Qué dice la legislación sobre protección de datos?',
    max_results: 5,
    temperature: 0.7
  })
});

const data = await response.json();
console.log('Answer:', data.answer);
console.log('Sources:', data.sources.length);
```

### 3. List Documents

Get a paginated list of BOE documents.

**Request:**
```bash
curl -X GET "http://localhost:8000/documents?limit=10&offset=0"
```

**Response:**
```json
{
  "documents": [
    {
      "boe_id": "BOE-A-2024-12345",
      "title": "Real Decreto sobre...",
      "publication_date": "2024-01-15",
      "document_type": "Real Decreto",
      "department": "Ministerio de Justicia",
      "url": "https://www.boe.es/..."
    }
  ],
  "count": 10
}
```

### 4. Get Specific Document

Retrieve details of a specific BOE document.

**Request:**
```bash
curl -X GET "http://localhost:8000/documents/BOE-A-2024-12345"
```

**Response:**
```json
{
  "boe_id": "BOE-A-2024-12345",
  "title": "Real Decreto sobre protección de datos",
  "summary": "Establece las normas para...",
  "publication_date": "2024-01-15",
  "document_type": "Real Decreto",
  "department": "Ministerio de Justicia",
  "section": "I",
  "url": "https://www.boe.es/...",
  "pdf_url": "https://www.boe.es/...pdf",
  "full_text": "El texto completo del documento...",
  "metadata": {
    "section": "I",
    "subsection": "Disposiciones generales"
  }
}
```

### 5. Get Statistics

Get statistics about the document collection.

**Request:**
```bash
curl -X GET "http://localhost:8000/stats"
```

**Response:**
```json
{
  "total_documents": 1250,
  "total_chunks": 45000,
  "date_range": {
    "min": "2023-01-01",
    "max": "2024-02-06"
  },
  "document_types": [
    {
      "type": "Ley",
      "count": 250
    },
    {
      "type": "Real Decreto",
      "count": 400
    },
    {
      "type": "Orden",
      "count": 600
    }
  ]
}
```

## Query Parameters

### `/query` endpoint

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| question | string | required | The question to ask |
| max_results | integer | 5 | Number of source documents (1-20) |
| temperature | float | 0.7 | LLM temperature (0.0-2.0) |

### `/documents` endpoint

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| limit | integer | 10 | Number of documents to return (1-100) |
| offset | integer | 0 | Number of documents to skip |

## Error Responses

### 404 Not Found
```json
{
  "detail": "Document not found"
}
```

### 500 Internal Server Error
```json
{
  "detail": "Error processing query: <error message>"
}
```

### 422 Validation Error
```json
{
  "detail": [
    {
      "loc": ["body", "max_results"],
      "msg": "ensure this value is less than or equal to 20",
      "type": "value_error.number.not_le"
    }
  ]
}
```

## Advanced Usage

### Adjusting Response Quality

**Higher Temperature (more creative)**:
```json
{
  "question": "¿Qué implica la nueva normativa?",
  "temperature": 1.2
}
```

**Lower Temperature (more focused)**:
```json
{
  "question": "¿Cuál es el artículo 25?",
  "temperature": 0.3
}
```

### Getting More Context

```json
{
  "question": "¿Qué dice sobre contratos laborales?",
  "max_results": 10
}
```

## Integration Examples

### Python SDK
```python
class BOEClient:
    def __init__(self, base_url="http://localhost:8000"):
        self.base_url = base_url
    
    def query(self, question, max_results=5, temperature=0.7):
        response = requests.post(
            f"{self.base_url}/query",
            json={
                "question": question,
                "max_results": max_results,
                "temperature": temperature
            }
        )
        response.raise_for_status()
        return response.json()
    
    def get_document(self, boe_id):
        response = requests.get(f"{self.base_url}/documents/{boe_id}")
        response.raise_for_status()
        return response.json()

# Usage
client = BOEClient()
result = client.query("¿Qué dice sobre RGPD?")
print(result["answer"])
```

### cURL Script
```bash
#!/bin/bash

API_URL="http://localhost:8000"
QUESTION="¿Qué dice la ley sobre privacidad?"

response=$(curl -s -X POST "$API_URL/query" \
  -H "Content-Type: application/json" \
  -d "{
    \"question\": \"$QUESTION\",
    \"max_results\": 5
  }")

echo "$response" | jq '.answer'
```

## Rate Limiting

Currently, no rate limiting is implemented. For production:
- Implement rate limiting middleware
- Use API keys for tracking
- Set appropriate limits (e.g., 100 requests/minute)

## Best Practices

1. **Be Specific**: Ask specific questions for better results
2. **Use Context**: Include relevant context in your questions
3. **Adjust Temperature**: Lower for factual queries, higher for creative
4. **Cache Results**: Cache frequent queries to reduce load
5. **Handle Errors**: Always handle API errors gracefully
6. **Respect Limits**: Don't exceed rate limits in production

## Troubleshooting

### Empty Results
- Check if data has been loaded (run initial_load DAG)
- Verify embeddings are generated
- Try broader questions

### Slow Responses
- LLM generation takes time (5-30 seconds)
- Consider using smaller models
- Enable GPU acceleration for Ollama

### Connection Errors
- Verify all services are running: `make status`
- Check health endpoint: `curl http://localhost:8000/health`
- Review logs: `make logs-api`
