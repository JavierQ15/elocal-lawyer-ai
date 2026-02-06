-- Database initialization for BOE Legislation RAG System
-- This script creates the schema for storing BOE legislation data

-- Create extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Table for storing BOE documents (source of truth)
CREATE TABLE IF NOT EXISTS boe_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    boe_id VARCHAR(255) UNIQUE NOT NULL,
    title TEXT NOT NULL,
    summary TEXT,
    publication_date DATE NOT NULL,
    document_type VARCHAR(100),
    department VARCHAR(255),
    section VARCHAR(255),
    url TEXT,
    pdf_url TEXT,
    content_hash VARCHAR(64) NOT NULL, -- SHA256 hash for idempotency
    full_text TEXT,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table for storing document chunks (for RAG)
CREATE TABLE IF NOT EXISTS document_chunks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id UUID REFERENCES boe_documents(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    chunk_text TEXT NOT NULL,
    chunk_hash VARCHAR(64) NOT NULL, -- SHA256 hash for idempotency
    vector_id VARCHAR(255), -- Reference to vector in Qdrant
    metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (document_id, chunk_index)
);

-- Table for tracking ingestion status
CREATE TABLE IF NOT EXISTS ingestion_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    boe_id VARCHAR(255),
    status VARCHAR(50) NOT NULL, -- 'pending', 'processing', 'completed', 'failed'
    ingestion_type VARCHAR(50) NOT NULL, -- 'initial', 'incremental'
    error_message TEXT,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_boe_documents_publication_date ON boe_documents(publication_date DESC);
CREATE INDEX IF NOT EXISTS idx_boe_documents_content_hash ON boe_documents(content_hash);
CREATE INDEX IF NOT EXISTS idx_boe_documents_boe_id ON boe_documents(boe_id);
CREATE INDEX IF NOT EXISTS idx_document_chunks_document_id ON document_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_document_chunks_chunk_hash ON document_chunks(chunk_hash);
CREATE INDEX IF NOT EXISTS idx_ingestion_log_status ON ingestion_log(status);
CREATE INDEX IF NOT EXISTS idx_ingestion_log_boe_id ON ingestion_log(boe_id);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for auto-updating updated_at
CREATE TRIGGER update_boe_documents_updated_at
    BEFORE UPDATE ON boe_documents
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create view for recent documents
CREATE OR REPLACE VIEW recent_documents AS
SELECT 
    id,
    boe_id,
    title,
    publication_date,
    document_type,
    department,
    created_at
FROM boe_documents
ORDER BY publication_date DESC
LIMIT 100;

-- Grant permissions (adjust as needed)
-- GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO your_user;
-- GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO your_user;
