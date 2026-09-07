import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getDb } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";

/**
 * Accounts are optional, like every other dependency in this project.
 *
 * With no `BETTER_AUTH_SECRET` the whole feature is off: `/login` and `/signup`
 * answer 503, no auth UI renders, and the app behaves exactly as it did before
 * #5 — anonymous sessions, uploads that belong to a browser, no library. A
 * self-hosted single-user instance never has to configure auth at all.
 *
 * This is checked rather than defaulted on purpose. A generated fallback secret
 * would silently invalidate every session on restart, which is a worse failure
 * than a feature that is visibly switched off.
 */
export function isAuthEnabled(): boolean {
  return Boolean(process.env.BETTER_AUTH_SECRET);
}

export const AUTH_DISABLED_MESSAGE =
  "Accounts are not enabled on this instance (set BETTER_AUTH_SECRET — see SETUP.md).";

/** Which OAuth buttons the sign-in page should render. Same conditional-
 * enablement pattern `lib/providers/registry.ts` uses for search providers:
 * a provider without credentials is absent, not broken. */
export function configuredSocialProviders(): Array<"github" | "google"> {
  const providers: Array<"github" | "google"> = [];
  if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) providers.push("github");
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) providers.push("google");
  return providers;
}

/** SMTP is absent on most instances. Verification is then off and password
 * reset says so plainly, rather than sending mail into a void. Sign-up is
 * deliberately NOT blocked by this — that would make an optional dependency
 * mandatory through the back door. */
function trustedOrigins(): string[] {
  const configured = (process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (process.env.NODE_ENV === "production") return configured;
  return [...configured, "http://localhost:*", "http://127.0.0.1:*"];
}

export function isMailerConfigured(): boolean {
  return Boolean(process.env.SMTP_URL);
}

function buildAuth() {
  const social = configuredSocialProviders();
  return betterAuth({
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL,
    /**
     * better-auth 1.7 rejects any origin it was not told about, so a
     * self-hosted instance answers "Invalid origin" to its own sign-in form
     * unless it knows where it is served from. Observed live: the app worked at
     * localhost:3010 and refused 127.0.0.1:3100.
     *
     * A per-request function is not an option — better-auth resolves this list
     * once at context creation, without a request — so the origins have to be
     * declared. `BETTER_AUTH_URL` contributes its own origin automatically;
     * `BETTER_AUTH_TRUSTED_ORIGINS` adds any others (a second domain, a
     * preview deployment) as a comma-separated list.
     *
     * Loopback is wildcarded outside production so `pnpm dev` works on
     * whatever port is free without configuration. It is NOT wildcarded in
     * production: there, every origin is one the operator named.
     */
    trustedOrigins: trustedOrigins(),
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    emailAndPassword: {
      enabled: true,
      // Off unless a mailer exists. With none, requiring it would leave every
      // new account permanently locked out.
      requireEmailVerification: isMailerConfigured(),
    },
    // Explicit, not left at default: brute-forcing a password form is the
    // single most likely attack on a small self-hosted instance.
    //
    // Two tiers, because one number cannot serve both jobs. Every page load
    // calls `get-session` through the root layout, so a single tight global
    // limit locks out ordinary browsing — worse behind a NAT or a corporate
    // proxy, where a whole office shares one address. (A flat 20/minute did
    // exactly that, and the end-to-end tests hit it within one run.) The
    // generous global covers session reads; the tight custom rules cover the
    // endpoints where brute force actually buys an attacker something.
    rateLimit: {
      enabled: true,
      window: 60,
      max: 120,
      customRules: {
        // 20/minute/address is a hard wall for brute force while leaving room
        // for an office behind one NAT address all signing in at 9am. There is
        // deliberately no way to switch this off: an escape hatch that works
        // under NODE_ENV=production is an escape hatch in production, and the
        // end-to-end suite runs a production build.
        "/sign-in/email": { window: 60, max: 20 },
        "/sign-up/email": { window: 60, max: 20 },
        "/forget-password": { window: 60, max: 5 },
        "/reset-password": { window: 60, max: 5 },
      },
    },
    socialProviders: {
      ...(social.includes("github")
        ? {
            github: {
              clientId: process.env.GITHUB_CLIENT_ID!,
              clientSecret: process.env.GITHUB_CLIENT_SECRET!,
            },
          }
        : {}),
      ...(social.includes("google")
        ? {
            google: {
              clientId: process.env.GOOGLE_CLIENT_ID!,
              clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
            },
          }
        : {}),
    },
  });
}

// better-auth infers its instance type from the exact options object, so this
// cannot be annotated by hand without losing the inferred API surface.
let instance: ReturnType<typeof buildAuth> | null = null;

/**
 * Lazy for the same reason `getDb()` is: importing this module must never
 * construct an auth instance or touch the database, so build-time route
 * collection and unit tests stay safe on an instance with no auth configured.
 */
export function getAuth(): ReturnType<typeof buildAuth> {
  if (!isAuthEnabled()) throw new Error(AUTH_DISABLED_MESSAGE);
  if (!instance) instance = buildAuth();
  return instance;
}
