-- Sub-project #5: accounts and library.
--
-- Hand-written for the same reason 0011 was: the drizzle-kit snapshot carries
-- ten scaffolding tables schema.ts no longer declares, so `generate` demands
-- interactive create-vs-rename disambiguation and would otherwise emit ten
-- DROP TABLEs. See KNOWN_LIMITATIONS.md.

-- better-auth's four tables. Column names are load-bearing: its Drizzle
-- adapter looks them up by name at runtime.
CREATE TABLE IF NOT EXISTS "user" (
  "id" text PRIMARY KEY,
  "name" text NOT NULL,
  "email" text NOT NULL UNIQUE,
  "email_verified" boolean DEFAULT false NOT NULL,
  "image" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "session" (
  "id" text PRIMARY KEY,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "token" text NOT NULL UNIQUE,
  "expires_at" timestamp with time zone NOT NULL,
  "ip_address" text,
  "user_agent" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "session_user_idx" ON "session" ("user_id");

CREATE TABLE IF NOT EXISTS "account" (
  "id" text PRIMARY KEY,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "account_id" text NOT NULL,
  "provider_id" text NOT NULL,
  "access_token" text,
  "refresh_token" text,
  "access_token_expires_at" timestamp with time zone,
  "refresh_token_expires_at" timestamp with time zone,
  "scope" text,
  "id_token" text,
  "password" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "account_user_idx" ON "account" ("user_id");

CREATE TABLE IF NOT EXISTS "verification" (
  "id" text PRIMARY KEY,
  "identifier" text NOT NULL,
  "value" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "verification_identifier_idx" ON "verification" ("identifier");

-- Adoption target for #2's anonymous uploads. Nullable: a document uploaded
-- without an account keeps working, owned by its session alone.
ALTER TABLE "document" ADD COLUMN IF NOT EXISTS "user_id" text;
CREATE INDEX IF NOT EXISTS "document_user_created_idx" ON "document" ("user_id", "created_at");

CREATE TABLE IF NOT EXISTS "collection" (
  "id" serial PRIMARY KEY,
  "public_id" text NOT NULL UNIQUE,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "description" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "collection_user_name_idx" ON "collection" ("user_id", "name");
CREATE INDEX IF NOT EXISTS "collection_user_updated_idx" ON "collection" ("user_id", "updated_at");

CREATE TABLE IF NOT EXISTS "saved_item" (
  "id" serial PRIMARY KEY,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "item_type" text NOT NULL,
  "work_key" text,
  "document_id" text,
  "work_snapshot" jsonb,
  "note" text,
  "saved_at" timestamp with time zone DEFAULT now() NOT NULL,
  -- Keeps the polymorphism honest in the database rather than in application
  -- code: exactly one parent column is set, and it matches item_type.
  CONSTRAINT "saved_item_shape" CHECK (
    ("item_type" = 'work'     AND "work_key"    IS NOT NULL AND "document_id" IS NULL)
    OR
    ("item_type" = 'document' AND "document_id" IS NOT NULL AND "work_key"    IS NULL)
  )
);
-- Partial: a NULL work_key must not collide with another NULL work_key, which
-- a plain UNIQUE would allow anyway in Postgres but is stated explicitly here
-- so the intent survives a future Postgres that treats NULLs as equal.
CREATE UNIQUE INDEX IF NOT EXISTS "saved_item_user_work_idx"
  ON "saved_item" ("user_id", "work_key") WHERE "work_key" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "saved_item_user_document_idx"
  ON "saved_item" ("user_id", "document_id") WHERE "document_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "saved_item_user_saved_idx" ON "saved_item" ("user_id", "saved_at");

CREATE TABLE IF NOT EXISTS "collection_item" (
  "id" serial PRIMARY KEY,
  "collection_id" integer NOT NULL REFERENCES "collection"("id") ON DELETE CASCADE,
  "saved_item_id" integer NOT NULL REFERENCES "saved_item"("id") ON DELETE CASCADE,
  "position" integer NOT NULL,
  "added_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "collection_item_pair_idx"
  ON "collection_item" ("collection_id", "saved_item_id");
CREATE INDEX IF NOT EXISTS "collection_item_order_idx"
  ON "collection_item" ("collection_id", "position");
