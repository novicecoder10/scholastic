-- Sponsored endpoints: relays and donated compute nodes.
--
-- Both are OpenAI-compatible URLs rather than keys, which is the whole point.
-- A lab that cannot export a naked key can still donate capacity by pointing
-- this at a relay it runs; a cluster can donate off-peak hours. Nothing added
-- here is a secret: base_url is a URL, and credential_ref remains the NAME of
-- an environment variable.

ALTER TABLE "capacity_source" ADD COLUMN IF NOT EXISTS "base_url" text;
ALTER TABLE "capacity_source" ADD COLUMN IF NOT EXISTS "served_model" text;
ALTER TABLE "capacity_source" ADD COLUMN IF NOT EXISTS "active_hours_utc" text;
ALTER TABLE "capacity_source" ADD COLUMN IF NOT EXISTS "active_days" text;
ALTER TABLE "capacity_source" ADD COLUMN IF NOT EXISTS "dormant_until" timestamptz;

-- Null only for an endpoint that needs no credential at all — a campus node on
-- a private network. Every keyed provider is still rejected without one, which
-- is enforced in `hasCredential`, not here.
ALTER TABLE "capacity_source" ALTER COLUMN "credential_ref" DROP NOT NULL;

-- The dispatcher trips a source out of rotation by date, so it has to be able
-- to find the ones whose clock has run out without scanning the table.
CREATE INDEX IF NOT EXISTS "capacity_source_dormant_idx"
  ON "capacity_source" ("dormant_until");
