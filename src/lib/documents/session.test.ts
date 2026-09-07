import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// cookies() is a Next server-only API; only the pure signing helpers are
// exercised here. The cookie round-trip through a Route Handler is Playwright's
// job (see the accounts spec, which escalates that gap).
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

import { newSessionId, signSessionId, verifySessionCookie } from "@/lib/documents/session";

const originalSecret = process.env.SESSION_SECRET;

beforeEach(() => {
  process.env.SESSION_SECRET = "test-secret-value";
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = originalSecret;
});

describe("session cookie signing", () => {
  it("round-trips a session id", () => {
    const id = newSessionId();
    expect(verifySessionCookie(signSessionId(id))).toBe(id);
  });

  it("mints unguessable ids", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newSessionId()));
    expect(ids.size).toBe(200);
    expect(newSessionId().length).toBeGreaterThanOrEqual(24);
  });

  it("rejects a tampered session id", () => {
    const signed = signSessionId("abc");
    expect(verifySessionCookie(`zzz.${signed.split(".")[1]}`)).toBeNull();
  });

  it("rejects a tampered signature", () => {
    const [id] = signSessionId("abc").split(".");
    expect(verifySessionCookie(`${id}.${"0".repeat(64)}`)).toBeNull();
  });

  it("rejects a signature of the wrong length without throwing", () => {
    // timingSafeEqual throws on a length mismatch, which a forged cookie can
    // trivially cause — this asserts the length is checked first.
    expect(() => verifySessionCookie("abc.00")).not.toThrow();
    expect(verifySessionCookie("abc.00")).toBeNull();
  });

  it("rejects a cookie with no signature at all", () => {
    expect(verifySessionCookie("justanid")).toBeNull();
    expect(verifySessionCookie(".abc")).toBeNull();
    expect(verifySessionCookie("")).toBeNull();
  });

  it("rejects a cookie signed under a different secret", () => {
    const signed = signSessionId("abc");
    process.env.SESSION_SECRET = "a-completely-different-secret";
    expect(verifySessionCookie(signed)).toBeNull();
  });

  it("tolerates a session id containing dots by splitting on the last one", () => {
    const id = "a.b.c";
    expect(verifySessionCookie(signSessionId(id))).toBe(id);
  });

  it("reuses one ephemeral secret across module graphs when SESSION_SECRET is unset", async () => {
    // Next bundles Route Handlers and Server Components separately, so this
    // module is instantiated more than once per process. A module-scoped
    // fallback secret would differ between those instances and a cookie signed
    // in one would 404 in the other — which is exactly what happened before
    // the secret moved onto globalThis. Re-importing with a reset module
    // registry is the closest a unit test gets to a second bundle.
    delete process.env.SESSION_SECRET;
    delete (globalThis as { __scholasticEphemeralSessionSecret?: string })
      .__scholasticEphemeralSessionSecret;

    vi.resetModules();
    const first = await import("@/lib/documents/session");
    const cookie = first.signSessionId("session-abc");

    vi.resetModules();
    const second = await import("@/lib/documents/session");

    expect(second.verifySessionCookie(cookie)).toBe("session-abc");
  });
});
