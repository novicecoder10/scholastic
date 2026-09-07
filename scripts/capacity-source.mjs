#!/usr/bin/env node
/**
 * Adds or updates a capacity source — the operator-mediated half of
 * sponsorship.
 *
 * This is a CLI on purpose. A web form that accepts a sponsor's API key would
 * be the single worst thing this project could build, so there isn't one: the
 * operator puts the key in the environment and records the variable's NAME
 * here. Nothing in the database ever holds a secret.
 *
 * Usage:
 *   node scripts/capacity-source.mjs \
 *     --id acme-groq --label "Acme Labs (Groq)" --provider groq \
 *     --credential GROQ_API_KEY --sponsor "Acme Labs" \
 *     --url https://acme.example --public --cap 50000000
 *
 * A sponsor who cannot export a key at all donates an endpoint instead — a
 * relay they run, or a cluster's idle hours:
 *
 *   node scripts/capacity-source.mjs \
 *     --id mp-relay --label "Max Planck relay" --provider outpost \
 *     --base-url https://ai-relay.mp-lab.org/v1 --model mistral-large \
 *     --credential MP_RELAY_TOKEN --sponsor "Max Planck Research Group"
 *
 *   node scripts/capacity-source.mjs \
 *     --id hpc-4 --label "University HPC 4" --provider node \
 *     --base-url https://hpc-node12.cs.edu/v1 --model deepseek-r1-distill-70b \
 *     --hours 18:00-06:00 --days 1,2,3,4,5
 *
 *   node scripts/capacity-source.mjs --list
 *   node scripts/capacity-source.mjs --disable acme-groq
 *   node scripts/capacity-source.mjs --revive acme-groq
 */
import postgres from "postgres";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const PROVIDERS = ["anthropic", "groq", "sambanova", "mistral", "openrouter", "gemini"];
/** Capacity donated as a URL rather than a key. See lib/capacity/endpoints.ts. */
const ENDPOINT_PROVIDERS = ["outpost", "node"];

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}
function flag(name) {
  return process.argv.includes(`--${name}`);
}
function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

if (!process.env.DATABASE_URL) fail("DATABASE_URL is not set");
const sql = postgres(process.env.DATABASE_URL);

try {
  if (flag("list")) {
    const rows = await sql`SELECT id, label, provider_id, credential_ref, sponsor_name, status,
                                  monthly_token_cap, tokens_used_period, base_url, served_model,
                                  active_hours_utc, active_days, dormant_until
                           FROM capacity_source ORDER BY sponsor_name NULLS LAST, id`;
    if (rows.length === 0) {
      console.log("No capacity sources. The app falls back to static provider selection.");
    }
    for (const row of rows) {
      const key = row.credential_ref
        ? `${row.credential_ref} (${process.env[row.credential_ref] ? "key present" : "KEY MISSING"})`
        : "no credential";
      const cap = row.monthly_token_cap
        ? `${row.tokens_used_period}/${row.monthly_token_cap}`
        : "uncapped";
      // Dormancy is a clock, so print the clock: "dormant" on its own tells an
      // operator nothing about whether to go and look at the key.
      const dormant =
        row.dormant_until && new Date(row.dormant_until) > new Date()
          ? `  dormant until ${new Date(row.dormant_until).toISOString().slice(11, 16)}Z`
          : "";
      const endpoint = row.base_url ? `  ${row.base_url} (${row.served_model})` : "";
      const window = row.active_hours_utc
        ? `  ${row.active_hours_utc} UTC${row.active_days ? ` on ${row.active_days}` : ""}`
        : "";
      console.log(
        `${row.id}  ${row.provider_id}  ${row.status}  ${cap}  ${key}` +
          (row.sponsor_name ? `  sponsor: ${row.sponsor_name}` : "  operator") +
          endpoint +
          window +
          dormant,
      );
    }
    process.exit(0);
  }

  const revive = arg("revive");
  if (revive) {
    const [row] = await sql`UPDATE capacity_source
                            SET status = 'active', dormant_until = NULL
                            WHERE id = ${revive} RETURNING id`;
    console.log(row ? `Revived ${row.id}.` : `No source with id ${revive}.`);
    process.exit(0);
  }

  const disable = arg("disable");
  if (disable) {
    const [row] = await sql`UPDATE capacity_source SET status = 'disabled'
                            WHERE id = ${disable} RETURNING id`;
    console.log(row ? `Disabled ${row.id}.` : `No source with id ${disable}.`);
    process.exit(0);
  }

  const id = arg("id");
  const label = arg("label");
  const provider = arg("provider");
  const credential = arg("credential");
  const baseUrl = arg("base-url") ?? null;
  const model = arg("model") ?? null;
  const hours = arg("hours") ?? null;
  const days = arg("days") ?? null;
  const isEndpoint = ENDPOINT_PROVIDERS.includes(provider ?? "");

  if (!id || !label || !provider) {
    fail("--id, --label and --provider are all required (see --help in the header)");
  }
  if (!PROVIDERS.includes(provider) && !isEndpoint) {
    fail(`--provider must be one of: ${[...PROVIDERS, ...ENDPOINT_PROVIDERS].join(", ")}`);
  }
  if (isEndpoint) {
    // An endpoint is a URL and a model. Without both there is nothing to call,
    // and a half-recorded source would sit in the pool being skipped silently.
    if (!baseUrl || !model) fail("--base-url and --model are required for an outpost or a node");
    if (!/^https?:\/\//.test(baseUrl)) fail("--base-url must be an http(s) URL");
    // A relay's bearer token is a secret like any other: named, never pasted.
    // A node on a private network legitimately has none.
    if (!credential) {
      console.warn("warning: no --credential; this endpoint will be called unauthenticated");
    }
  } else if (!credential) {
    fail("--credential is required for a keyed provider");
  }
  if (!isEndpoint && (baseUrl || model || hours || days)) {
    fail("--base-url, --model, --hours and --days apply only to an outpost or a node");
  }
  if (hours && !/^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/.test(hours)) {
    fail("--hours must look like 18:00-06:00, in UTC");
  }
  if (days && !/^[1-7](,[1-7])*$/.test(days)) {
    fail("--days must be ISO weekday numbers, e.g. 1,2,3,4,5 (Monday is 1)");
  }
  if (credential) {
    // A pasted key would be a secret in a shell history and then in a database.
    if (credential.length > 60 || /[^A-Z0-9_]/.test(credential)) {
      fail("--credential must be the NAME of an environment variable, not a key");
    }
    if (!process.env[credential]) {
      console.warn(
        `warning: ${credential} is not set in this environment; the source will be skipped until it is`,
      );
    }
  }

  const cap = arg("cap") ? Number.parseInt(arg("cap"), 10) : null;
  const sponsor = arg("sponsor") ?? null;
  const url = arg("url") ?? null;
  const isPublic = flag("public");

  await sql`
    INSERT INTO capacity_source
      (id, label, provider_id, credential_ref, sponsor_name, sponsor_url, is_public,
       monthly_token_cap, period_starts_at, status, base_url, served_model,
       active_hours_utc, active_days, dormant_until)
    VALUES (${id}, ${label}, ${provider}, ${credential ?? null}, ${sponsor}, ${url}, ${isPublic},
            ${cap}, date_trunc('month', now()), 'active', ${baseUrl}, ${model},
            ${hours}, ${days}, NULL)
    ON CONFLICT (id) DO UPDATE SET
      label = EXCLUDED.label, provider_id = EXCLUDED.provider_id,
      credential_ref = EXCLUDED.credential_ref, sponsor_name = EXCLUDED.sponsor_name,
      sponsor_url = EXCLUDED.sponsor_url, is_public = EXCLUDED.is_public,
      monthly_token_cap = EXCLUDED.monthly_token_cap, status = 'active',
      base_url = EXCLUDED.base_url, served_model = EXCLUDED.served_model,
      active_hours_utc = EXCLUDED.active_hours_utc, active_days = EXCLUDED.active_days,
      dormant_until = NULL`;

  console.log(
    isEndpoint
      ? `Recorded capacity source ${id} (${provider} at ${baseUrl}, serving ${model}).`
      : `Recorded capacity source ${id} (${provider}, key from $${credential}).`,
  );
} finally {
  await sql.end();
}
