CREATE TYPE document_status AS ENUM ('queued', 'processing', 'completed', 'failed');

CREATE TYPE template_type AS ENUM ('invoice', 'report', 'certificate');

CREATE TABLE IF NOT EXISTS public_documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status        document_status NOT NULL DEFAULT 'queued',
  template_type template_type   NOT NULL,
  file_url      TEXT,
  error_reason  TEXT,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);
