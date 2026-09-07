-- Sub-project #6: credits and sponsorship.
--
-- Three concepts kept deliberately separate: capacity (real provider quota),
-- credits (a user's claim on it), and contribution (what mints a claim).
-- Conflating them is the failure mode this schema exists to avoid.

-- `credential_ref` is the NAME of an environment variable. No table in this
-- database ever holds a provider key.
CREATE TABLE IF NOT EXISTS "capacity_source" (
  "id" text PRIMARY KEY,
  "label" text NOT NULL,
  "provider_id" text NOT NULL,
  "credential_ref" text NOT NULL,
  "sponsor_name" text,
  "sponsor_url" text,
  "is_public" boolean NOT NULL DEFAULT false,
  "monthly_token_cap" bigint,
  "tokens_used_period" bigint NOT NULL DEFAULT 0,
  "period_starts_at" timestamptz NOT NULL DEFAULT now(),
  "status" text NOT NULL DEFAULT 'active',
  CONSTRAINT "capacity_source_status_check"
    CHECK ("status" IN ('active', 'exhausted', 'disabled'))
);
CREATE INDEX IF NOT EXISTS "capacity_source_status_idx"
  ON "capacity_source" ("status", "provider_id");

CREATE TABLE IF NOT EXISTS "credit_ledger" (
  "id" bigserial PRIMARY KEY,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "delta" integer NOT NULL,
  "reason" text NOT NULL,
  "detail" jsonb,
  "balance_after" integer NOT NULL,
  "idempotency_key" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "credit_ledger_reason_check" CHECK ("reason" IN (
    'welcome_grant', 'periodic_replenishment', 'publication_verified',
    'peer_review_verified', 'spend', 'refund', 'operator_adjustment'
  ))
);
CREATE INDEX IF NOT EXISTS "credit_ledger_user_created_idx"
  ON "credit_ledger" ("user_id", "created_at" DESC);

-- Partial, because most rows (every spend) carry no key. A grant that runs
-- twice must award once, and that guarantee belongs in the database.
CREATE UNIQUE INDEX IF NOT EXISTS "credit_ledger_idempotency_idx"
  ON "credit_ledger" ("user_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "credit_balance" (
  "user_id" text PRIMARY KEY REFERENCES "user"("id") ON DELETE CASCADE,
  "balance" integer NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "orcid_identity" (
  "user_id" text PRIMARY KEY REFERENCES "user"("id") ON DELETE CASCADE,
  "orcid" text NOT NULL,
  "verified_at" timestamptz NOT NULL DEFAULT now(),
  "last_checked_at" timestamptz
);
-- One ORCID iD belongs to one account. Two accounts claiming the same iD would
-- let one researcher's publication record mint credits twice.
CREATE UNIQUE INDEX IF NOT EXISTS "orcid_identity_orcid_idx"
  ON "orcid_identity" ("orcid");

CREATE TABLE IF NOT EXISTS "anonymous_allowance" (
  "session_id" text PRIMARY KEY,
  "used" integer NOT NULL DEFAULT 0,
  "period_starts_at" timestamptz NOT NULL DEFAULT now()
);
