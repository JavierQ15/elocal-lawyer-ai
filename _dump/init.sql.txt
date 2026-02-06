-- Database initialization for BOE Legislation RAG System
-- This script creates the schema for storing BOE consolidated legislation data

-- Create extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- NEW SCHEMA FOR BOE CONSOLIDADA (Legislación Consolidada)
-- =============================================================================

-- Table for storing normas (laws/regulations)
CREATE TABLE IF NOT EXISTS boe_norma (
    id_norma VARCHAR(255) PRIMARY KEY,  -- e.g., BOE-A-2024-12345
    titulo TEXT NOT NULL,
    rango VARCHAR(255),  -- e.g., Ley, Real Decreto, etc.
    departamento VARCHAR(255),
    ambito VARCHAR(100),  -- e.g., Estatal, Autonómico
    fecha_publicacion DATE,
    fecha_disposicion DATE,
    url_html_consolidada TEXT,
    url_eli TEXT,  -- European Legislation Identifier
    fecha_actualizacion_api TIMESTAMP,
    metadata_jsonb JSONB,
    first_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table for storing bloques (sections/chapters) within normas
CREATE TABLE IF NOT EXISTS boe_bloque (
    id_norma VARCHAR(255) NOT NULL REFERENCES boe_norma(id_norma) ON DELETE CASCADE,
    id_bloque VARCHAR(255) NOT NULL,  -- e.g., TITULO_I, CAP_1, ART_5
    tipo VARCHAR(100),  -- e.g., Título, Capítulo, Artículo
    titulo_bloque TEXT,
    fecha_actualizacion_bloque TIMESTAMP,
    url_bloque TEXT,
    PRIMARY KEY (id_norma, id_bloque)
);

-- Table for storing versions of bloques (historical + current)
CREATE TABLE IF NOT EXISTS boe_version (
    id_version VARCHAR(64) PRIMARY KEY,  -- Deterministic SHA256 hash
    id_norma VARCHAR(255) NOT NULL,
    id_bloque VARCHAR(255) NOT NULL,
    id_norma_modificadora VARCHAR(255),  -- Which norma modified this version
    fecha_publicacion_mod DATE,
    fecha_vigencia_desde DATE NOT NULL,
    vigencia_hasta DATE,  -- NULL if currently valid
    hash_html VARCHAR(64) NOT NULL,
    hash_texto VARCHAR(64) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_norma, id_bloque) REFERENCES boe_bloque(id_norma, id_bloque) ON DELETE CASCADE
);

-- Table for storing fragmentos (chunks) from versions
CREATE TABLE IF NOT EXISTS boe_fragmento (
    id_fragmento VARCHAR(64) PRIMARY KEY,  -- Deterministic SHA256 hash
    id_version VARCHAR(64) NOT NULL REFERENCES boe_version(id_version) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL,
    texto_normalizado TEXT NOT NULL,
    hash_texto VARCHAR(64) NOT NULL,
    articulo_ref VARCHAR(255),  -- Optional article reference
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table for tracking pending embeddings
CREATE TABLE IF NOT EXISTS pending_embeddings (
    id_fragmento VARCHAR(64) PRIMARY KEY REFERENCES boe_fragmento(id_fragmento) ON DELETE CASCADE,
    status VARCHAR(50) DEFAULT 'pending',  -- pending, processing, completed, failed
    attempts INTEGER DEFAULT 0,
    last_error TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- LEGACY TABLES (kept for backward compatibility)
-- =============================================================================

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

-- =============================================================================
-- INDEXES FOR PERFORMANCE
-- =============================================================================

-- Indexes for boe_norma
CREATE INDEX IF NOT EXISTS idx_boe_norma_fecha_publicacion ON boe_norma(fecha_publicacion DESC);
CREATE INDEX IF NOT EXISTS idx_boe_norma_fecha_actualizacion ON boe_norma(fecha_actualizacion_api);
CREATE INDEX IF NOT EXISTS idx_boe_norma_rango ON boe_norma(rango);

-- Indexes for boe_bloque
CREATE INDEX IF NOT EXISTS idx_boe_bloque_id_norma ON boe_bloque(id_norma);
CREATE INDEX IF NOT EXISTS idx_boe_bloque_tipo ON boe_bloque(tipo);

-- Indexes for boe_version
CREATE INDEX IF NOT EXISTS idx_boe_version_id_norma ON boe_version(id_norma);
CREATE INDEX IF NOT EXISTS idx_boe_version_id_bloque ON boe_version(id_bloque);
CREATE INDEX IF NOT EXISTS idx_boe_version_vigencia_desde ON boe_version(fecha_vigencia_desde);
CREATE INDEX IF NOT EXISTS idx_boe_version_vigencia_hasta ON boe_version(vigencia_hasta);
CREATE INDEX IF NOT EXISTS idx_boe_version_hash_html ON boe_version(hash_html);
CREATE INDEX IF NOT EXISTS idx_boe_version_hash_texto ON boe_version(hash_texto);
CREATE INDEX IF NOT EXISTS idx_boe_version_norma_bloque ON boe_version(id_norma, id_bloque);

-- Indexes for boe_fragmento
CREATE INDEX IF NOT EXISTS idx_boe_fragmento_id_version ON boe_fragmento(id_version);
CREATE INDEX IF NOT EXISTS idx_boe_fragmento_hash_texto ON boe_fragmento(hash_texto);
CREATE INDEX IF NOT EXISTS idx_boe_fragmento_ordinal ON boe_fragmento(id_version, ordinal);

-- Indexes for pending_embeddings
CREATE INDEX IF NOT EXISTS idx_pending_embeddings_status ON pending_embeddings(status);
CREATE INDEX IF NOT EXISTS idx_pending_embeddings_created ON pending_embeddings(created_at);

-- Legacy indexes
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
