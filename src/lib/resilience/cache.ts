import { LRUCache } from "lru-cache";

export interface CacheBackend {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T, ttlMs: number): void;
}

/**
 * In-process cache for Milestone 1. Scholarly metadata is near-static, so cache
 * correctness bar is low, and the app isn't yet running at a scale where a shared
 * cross-instance cache matters (see KNOWN_LIMITATIONS.md). Swap point: implement
 * this same interface backed by Redis when horizontal scaling makes that necessary.
 */
interface Boxed<T> {
  value: T;
}

export class LruCacheBackend implements CacheBackend {
  // Values are boxed because lru-cache's value generic requires an object type,
  // which `unknown` (needed here since callers cache many different shapes) doesn't satisfy.
  private cache = new LRUCache<string, Boxed<unknown>>({
    max: 2000,
    ttl: 15 * 60_000,
  });

  get<T>(key: string): T | undefined {
    return this.cache.get(key)?.value as T | undefined;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    this.cache.set(key, { value }, { ttl: ttlMs });
  }
}

export const cache: CacheBackend = new LruCacheBackend();
