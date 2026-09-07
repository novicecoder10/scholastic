-- better-auth 1.7's `account` table carries an `issuer` column identifying the
-- account's issuing authority ("credential" for email+password). Missing it is
-- a 500 on sign-up rather than a compile error, so it is verified against
-- better-auth's own `getAuthTables()` rather than transcribed from docs.
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "issuer" text;
UPDATE "account" SET "issuer" = 'credential' WHERE "issuer" IS NULL;
ALTER TABLE "account" ALTER COLUMN "issuer" SET NOT NULL;
