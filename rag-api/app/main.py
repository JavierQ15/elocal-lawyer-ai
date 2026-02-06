"""
FastAPI RAG service for BOE legislation queries.
"""
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
import os

from .database import get_db_connection
from .embeddings import generate_embedding, search_vectors
from .llm import generate_response

app = FastAPI(
    title="BOE Legislation RAG API",
    description="RAG API for querying Spanish BOE consolidated legislation",
    version="1.0.0"
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class QueryRequest(BaseModel):
    """Request model for RAG queries."""
    question: str = Field(..., description="The question to ask about BOE legislation")
    max_results: int = Field(default=5, description="Maximum number of context documents to retrieve", ge=1, le=20)
    temperature: float = Field(default=0.7, description="LLM temperature for response generation", ge=0.0, le=2.0)


class DocumentResult(BaseModel):
    """Model for a single document result."""
    boe_id: str
    title: str
    chunk_text: str
    score: float
    publication_date: Optional[str]
    url: Optional[str]


class QueryResponse(BaseModel):
    """Response model for RAG queries."""
    answer: str
    sources: List[DocumentResult]
    query: str


class HealthResponse(BaseModel):
    """Health check response."""
    status: str
    services: Dict[str, str]


@app.get("/", tags=["Root"])
async def root():
    """Root endpoint."""
    return {
        "message": "BOE Legislation RAG API",
        "docs": "/docs",
        "health": "/health"
    }


@app.get("/health", response_model=HealthResponse, tags=["Health"])
async def health_check():
    """
    Health check endpoint to verify all services are operational.
    """
    services = {
        "api": "healthy",
        "postgres": "unknown",
        "qdrant": "unknown",
        "ollama": "unknown"
    }
    
    # Check PostgreSQL
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT 1")
        cursor.close()
        conn.close()
        services["postgres"] = "healthy"
    except Exception as e:
        services["postgres"] = f"unhealthy: {str(e)}"
    
    # Check Qdrant
    try:
        from .embeddings import get_qdrant_client
        client = get_qdrant_client()
        client.get_collections()
        services["qdrant"] = "healthy"
    except Exception as e:
        services["qdrant"] = f"unhealthy: {str(e)}"
    
    # Check Ollama
    try:
        import requests
        ollama_host = os.getenv('OLLAMA_HOST', 'ollama')
        ollama_port = os.getenv('OLLAMA_PORT', '11434')
        response = requests.get(f"http://{ollama_host}:{ollama_port}/api/tags", timeout=5)
        response.raise_for_status()
        services["ollama"] = "healthy"
    except Exception as e:
        services["ollama"] = f"unhealthy: {str(e)}"
    
    overall_status = "healthy" if all(s == "healthy" for s in services.values()) else "degraded"
    
    return HealthResponse(status=overall_status, services=services)


@app.post("/query", response_model=QueryResponse, tags=["RAG"])
async def query_legislation(request: QueryRequest):
    """
    Query BOE legislation using RAG.
    
    1. Generates embedding for the question
    2. Searches for relevant document chunks in Qdrant
    3. Retrieves full context from PostgreSQL
    4. Generates answer using Ollama LLM
    """
    try:
        # Generate embedding for the query
        query_embedding = generate_embedding(request.question)
        
        # Search for similar vectors in Qdrant
        search_results = search_vectors(query_embedding, limit=request.max_results)
        
        if not search_results:
            raise HTTPException(status_code=404, detail="No relevant documents found")
        
        # Retrieve full document information from PostgreSQL
        conn = get_db_connection()
        cursor = conn.cursor()
        
        sources = []
        context_texts = []
        
        for result in search_results:
            document_id = result.payload.get('document_id')
            chunk_index = result.payload.get('chunk_index')
            
            cursor.execute("""
                SELECT 
                    d.boe_id,
                    d.title,
                    d.publication_date,
                    d.url,
                    c.chunk_text
                FROM document_chunks c
                JOIN boe_documents d ON c.document_id = d.id
                WHERE c.document_id = %s AND c.chunk_index = %s
            """, (document_id, chunk_index))
            
            row = cursor.fetchone()
            if row:
                boe_id, title, pub_date, url, chunk_text = row
                
                sources.append(DocumentResult(
                    boe_id=boe_id,
                    title=title,
                    chunk_text=chunk_text,
                    score=result.score,
                    publication_date=str(pub_date) if pub_date else None,
                    url=url
                ))
                
                context_texts.append(f"Documento: {title}\nContenido: {chunk_text}")
        
        cursor.close()
        conn.close()
        
        # Generate response using LLM
        context = "\n\n---\n\n".join(context_texts)
        answer = generate_response(
            question=request.question,
            context=context,
            temperature=request.temperature
        )
        
        return QueryResponse(
            answer=answer,
            sources=sources,
            query=request.question
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing query: {str(e)}")


@app.get("/documents", tags=["Documents"])
async def list_documents(
    limit: int = Query(default=10, ge=1, le=100),
    offset: int = Query(default=0, ge=0)
):
    """
    List recent BOE documents.
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT 
                boe_id,
                title,
                publication_date,
                document_type,
                department,
                url
            FROM boe_documents
            ORDER BY publication_date DESC
            LIMIT %s OFFSET %s
        """, (limit, offset))
        
        documents = []
        for row in cursor.fetchall():
            documents.append({
                "boe_id": row[0],
                "title": row[1],
                "publication_date": str(row[2]) if row[2] else None,
                "document_type": row[3],
                "department": row[4],
                "url": row[5]
            })
        
        cursor.close()
        conn.close()
        
        return {"documents": documents, "count": len(documents)}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving documents: {str(e)}")


@app.get("/documents/{boe_id}", tags=["Documents"])
async def get_document(boe_id: str):
    """
    Get a specific BOE document by ID.
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT 
                boe_id,
                title,
                summary,
                publication_date,
                document_type,
                department,
                section,
                url,
                pdf_url,
                full_text,
                metadata
            FROM boe_documents
            WHERE boe_id = %s
        """, (boe_id,))
        
        row = cursor.fetchone()
        
        if not row:
            raise HTTPException(status_code=404, detail="Document not found")
        
        document = {
            "boe_id": row[0],
            "title": row[1],
            "summary": row[2],
            "publication_date": str(row[3]) if row[3] else None,
            "document_type": row[4],
            "department": row[5],
            "section": row[6],
            "url": row[7],
            "pdf_url": row[8],
            "full_text": row[9],
            "metadata": row[10]
        }
        
        cursor.close()
        conn.close()
        
        return document
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving document: {str(e)}")


@app.get("/stats", tags=["Statistics"])
async def get_statistics():
    """
    Get statistics about the document collection.
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Count total documents
        cursor.execute("SELECT COUNT(*) FROM boe_documents")
        total_documents = cursor.fetchone()[0]
        
        # Count total chunks
        cursor.execute("SELECT COUNT(*) FROM document_chunks")
        total_chunks = cursor.fetchone()[0]
        
        # Get date range
        cursor.execute("""
            SELECT MIN(publication_date), MAX(publication_date) 
            FROM boe_documents
        """)
        date_range = cursor.fetchone()
        
        # Get document types distribution
        cursor.execute("""
            SELECT document_type, COUNT(*) 
            FROM boe_documents 
            GROUP BY document_type
            ORDER BY COUNT(*) DESC
            LIMIT 10
        """)
        document_types = [{"type": row[0], "count": row[1]} for row in cursor.fetchall()]
        
        cursor.close()
        conn.close()
        
        return {
            "total_documents": total_documents,
            "total_chunks": total_chunks,
            "date_range": {
                "min": str(date_range[0]) if date_range[0] else None,
                "max": str(date_range[1]) if date_range[1] else None
            },
            "document_types": document_types
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving statistics: {str(e)}")
