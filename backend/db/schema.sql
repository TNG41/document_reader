-- Document Reader schema
-- Normalized to 3NF: each fact lives in exactly one table, joined by FK.

CREATE TABLE IF NOT EXISTS users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    -- Four authority levels, checked at the DB layer as well as in app
    -- code, so a bug in the API can't silently insert an invalid role.
    role          VARCHAR(20) NOT NULL DEFAULT 'user'
                    CHECK (role IN ('admin', 'executive', 'officer', 'user')),
    is_active     BOOLEAN NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS documents (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Who originally uploaded the file. Separate from owner_id (which
    -- could change hands later, e.g. a transfer/reassignment feature)
    -- so there's always an immutable record of the uploader even if
    -- ownership moves. SET NULL rather than CASCADE: deleting the
    -- uploader's account shouldn't delete documents they no longer own.
    uploaded_by       UUID REFERENCES users(id) ON DELETE SET NULL,
    original_filename VARCHAR(255) NOT NULL,
    stored_filename   VARCHAR(255) NOT NULL UNIQUE, -- server-generated, never trusts client name
    mime_type         VARCHAR(100) NOT NULL,
    file_size_bytes   BIGINT NOT NULL CHECK (file_size_bytes > 0),
    status            VARCHAR(20) NOT NULL DEFAULT 'uploaded'
                        CHECK (status IN ('uploaded', 'processing', 'done', 'failed')),
    uploaded_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotent upgrade path for databases created before uploaded_by existed.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL;
UPDATE documents SET uploaded_by = owner_id WHERE uploaded_by IS NULL;

-- One row per page of extracted text (keeps PDFs and multi-page scans queryable per-page)
CREATE TABLE IF NOT EXISTS extracted_pages (
    id            BIGSERIAL PRIMARY KEY,
    document_id   UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    page_number   INTEGER NOT NULL CHECK (page_number > 0),
    content       TEXT NOT NULL DEFAULT '',
    char_count    INTEGER GENERATED ALWAYS AS (char_length(content)) STORED,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (document_id, page_number)
);

-- Async job tracking — extraction (esp. OCR) can take seconds, so it runs off the request thread
CREATE TABLE IF NOT EXISTS processing_jobs (
    id            BIGSERIAL PRIMARY KEY,
    document_id   UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    status        VARCHAR(20) NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
    error_message TEXT,
    started_at    TIMESTAMPTZ,
    finished_at   TIMESTAMPTZ
);

-- Indexes for the query patterns the API actually uses
CREATE INDEX IF NOT EXISTS idx_users_role             ON users(role);
CREATE INDEX IF NOT EXISTS idx_documents_owner_id     ON documents(owner_id);
CREATE INDEX IF NOT EXISTS idx_documents_uploaded_by   ON documents(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_documents_status        ON documents(status);
CREATE INDEX IF NOT EXISTS idx_extracted_pages_doc_id  ON extracted_pages(document_id);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_doc_id  ON processing_jobs(document_id);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_status  ON processing_jobs(status);
