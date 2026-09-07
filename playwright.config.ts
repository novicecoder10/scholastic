import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests, added at sub-project #5 rather than deferred further.
 *
 * #3's spec noted that the absence of Playwright would start costing real time;
 * #5 is where the argument changes kind. Sign-in, sign-out, cookie rotation and
 * anonymous-session adoption are multi-request, cookie-dependent flows, and a
 * bug in them is a *security* bug — one user seeing another's library. A node
 * unit test can prove `resolveOwner` returns the right shape; only a browser
 * can prove the cookie actually rotated.
 *
 * Kept out of `vitest`'s `include` glob (`src/**` only) so `pnpm test` stays
 * fast and hermetic. Run these with `pnpm test:e2e`.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  // Auth flows share one database and one set of accounts; running them in
  // parallel would make them race each other rather than the code.
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // A production build, not `next dev`. The dev server compiles each route on
    // first request, which on a cold start blows past any reasonable
    // navigation timeout and makes the first test of every run look like a
    // failure. It also means these tests exercise what actually ships.
    // Set E2E_DEV=1 for a fast edit loop against the dev server instead.
    command: process.env.E2E_DEV
      ? `npx next dev -p ${PORT}`
      : `npx next build && npx next start -p ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    env: {
      // better-auth rejects requests whose origin doesn't match its configured
      // baseURL, so a BETTER_AUTH_URL pinned to the dev port in .env.local makes
      // every sign-in here fail silently — no error, no navigation. The e2e
      // server gets its own. (Next does not override an already-set env var.)
      BETTER_AUTH_URL: baseURL,
      // Accounts must be ON for these tests: they exist to prove the auth flows
      // work, and a checkout with no secret would otherwise skip past them green.
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "e2e-only-secret-not-for-production",
    },
  },
});
