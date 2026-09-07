import { describe, it, expect } from "vitest";
import { LruCacheBackend } from "@/lib/resilience/cache";

// Real timers with short real delays: lru-cache captures a reference to the real
// `performance` object at module-load time (before any per-test fake-timer setup
// runs), so faking global `performance.now()` later doesn't reach its internal
// TTL bookkeeping. Short real waits are more robust than fighting that interop.
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("LruCacheBackend", () => {
  it("returns undefined for a missing key", () => {
    const backend = new LruCacheBackend();
    expect(backend.get("missing")).toBeUndefined();
  });

  it("returns the stored value before the TTL expires", async () => {
    const backend = new LruCacheBackend();
    backend.set("k", { hello: "world" }, 200);
    await wait(20);
    expect(backend.get("k")).toEqual({ hello: "world" });
  });

  it("expires entries after their TTL", async () => {
    const backend = new LruCacheBackend();
    backend.set("k", "value", 50);
    await wait(80);
    expect(backend.get("k")).toBeUndefined();
  });

  it("supports independent TTLs per key", async () => {
    const backend = new LruCacheBackend();
    backend.set("short", "a", 50);
    backend.set("long", "b", 500);
    await wait(80);
    expect(backend.get("short")).toBeUndefined();
    expect(backend.get("long")).toBe("b");
  });
});
