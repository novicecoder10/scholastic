-- Sub-project #7: extracted data and evidence matrices.

CREATE TABLE IF NOT EXISTS "extraction" (
  "id" serial PRIMARY KEY,
  "document_id" text NOT NULL REFERENCES "document"("document_id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "model_id" text,
  "error" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "extraction_kind_check" CHECK ("kind" IN ('tables', 'findings')),
  CONSTRAINT "extraction_status_check" CHECK ("status" IN ('pending', 'ready', 'failed'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "extraction_document_kind_idx"
  ON "extraction" ("document_id", "kind");

CREATE TABLE IF NOT EXISTS "extracted_table" (
  "id" serial PRIMARY KEY,
  "document_id" text NOT NULL REFERENCES "document"("document_id") ON DELETE CASCADE,
  "page_number" integer NOT NULL,
  "caption" text,
  "grid" jsonb NOT NULL,
  "header_row" integer,
  "units" jsonb,
  "confidence" real NOT NULL,
  "description" text
);
CREATE INDEX IF NOT EXISTS "extracted_table_document_page_idx"
  ON "extracted_table" ("document_id", "page_number");

-- `quote` is NOT NULL by design: a finding that cannot cite its own source is
-- the fabrication this feature exists to make impossible, so the database
-- refuses to hold one.
CREATE TABLE IF NOT EXISTS "extracted_finding" (
  "id" serial PRIMARY KEY,
  "document_id" text NOT NULL REFERENCES "document"("document_id") ON DELETE CASCADE,
  "page_number" integer NOT NULL,
  "field" text NOT NULL,
  "value" text NOT NULL,
  "unit" text,
  "quote" text NOT NULL
);
CREATE INDEX IF NOT EXISTS "extracted_finding_document_field_idx"
  ON "extracted_finding" ("document_id", "field");

CREATE TABLE IF NOT EXISTS "matrix" (
  "id" serial PRIMARY KEY,
  "public_id" text NOT NULL UNIQUE,
  "user_id" text REFERENCES "user"("id") ON DELETE CASCADE,
  "owner_session_id" text,
  "title" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  -- Every matrix has exactly one kind of owner. Neither would be unreachable;
  -- both would make adoption ambiguous.
  CONSTRAINT "matrix_owner_check" CHECK (
    ("user_id" IS NOT NULL) OR ("owner_session_id" IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS "matrix_user_idx" ON "matrix" ("user_id", "updated_at" DESC);
CREATE INDEX IF NOT EXISTS "matrix_session_idx"
  ON "matrix" ("owner_session_id", "updated_at" DESC);

CREATE TABLE IF NOT EXISTS "matrix_column" (
  "id" serial PRIMARY KEY,
  "matrix_id" integer NOT NULL REFERENCES "matrix"("id") ON DELETE CASCADE,
  "position" integer NOT NULL,
  "label" text NOT NULL,
  "hint" text,
  "value_type" text NOT NULL DEFAULT 'text',
  CONSTRAINT "matrix_column_type_check" CHECK ("value_type" IN ('text', 'number', 'list'))
);
CREATE INDEX IF NOT EXISTS "matrix_column_order_idx"
  ON "matrix_column" ("matrix_id", "position");

CREATE TABLE IF NOT EXISTS "matrix_row" (
  "id" serial PRIMARY KEY,
  "matrix_id" integer NOT NULL REFERENCES "matrix"("id") ON DELETE CASCADE,
  "document_id" text NOT NULL REFERENCES "document"("document_id") ON DELETE CASCADE,
  "position" integer NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "matrix_row_document_idx"
  ON "matrix_row" ("matrix_id", "document_id");
CREATE INDEX IF NOT EXISTS "matrix_row_order_idx" ON "matrix_row" ("matrix_id", "position");

CREATE TABLE IF NOT EXISTS "matrix_cell" (
  "id" serial PRIMARY KEY,
  "matrix_id" integer NOT NULL REFERENCES "matrix"("id") ON DELETE CASCADE,
  "row_id" integer NOT NULL REFERENCES "matrix_row"("id") ON DELETE CASCADE,
  "column_id" integer NOT NULL REFERENCES "matrix_column"("id") ON DELETE CASCADE,
  "value" text,
  "unit" text,
  "quote" text,
  "page_number" integer,
  "status" text NOT NULL,
  "error" text,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "matrix_cell_status_check"
    CHECK ("status" IN ('found', 'not_reported', 'error')),
  -- A found cell without provenance is never rendered as a value, so it is
  -- never stored as one either. This is the difference between a tool usable in
  -- a systematic review and a plausible-looking fabrication.
  CONSTRAINT "matrix_cell_provenance_check" CHECK (
    "status" <> 'found'
    OR ("value" IS NOT NULL AND "quote" IS NOT NULL AND "page_number" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS "matrix_cell_pair_idx"
  ON "matrix_cell" ("row_id", "column_id");
