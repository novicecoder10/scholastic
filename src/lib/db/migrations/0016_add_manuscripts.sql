-- Sub-project #8: the AI writer.

-- user_id is NOT NULL here and nullable everywhere else on purpose: a
-- session-scoped manuscript is a data-loss trap dressed as convenience.
CREATE TABLE IF NOT EXISTS "manuscript" (
  "id" serial PRIMARY KEY,
  "public_id" text NOT NULL UNIQUE,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "doc" jsonb NOT NULL,
  "citation_style" text NOT NULL DEFAULT 'apa',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "manuscript_user_updated_idx"
  ON "manuscript" ("user_id", "updated_at" DESC);

CREATE TABLE IF NOT EXISTS "manuscript_revision" (
  "id" serial PRIMARY KEY,
  "manuscript_id" integer NOT NULL REFERENCES "manuscript"("id") ON DELETE CASCADE,
  "doc" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "manuscript_revision_idx"
  ON "manuscript_revision" ("manuscript_id", "created_at" DESC);
