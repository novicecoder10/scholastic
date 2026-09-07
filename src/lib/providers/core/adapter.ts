import type { ProviderAdapter, RawSearchResult, SearchOptions } from "@/lib/providers/types";
import { mapCoreWork, type CoreResponse } from "@/lib/providers/core/mapper";

const BASE_URL = "https://api.core.ac.uk/v3/search/works";

export const coreAdapter: ProviderAdapter = {
  meta: {
    id: "core",
    displayName: "CORE",
    requiresCredential: true,
    get isEnabled() {
      return coreAdapter.isConfigured();
    },
  },

  isConfigured() {
    return Boolean(process.env.CORE_API_KEY);
  },

  async search(options: SearchOptions): Promise<RawSearchResult> {
    const apiKey = process.env.CORE_API_KEY;
    if (!apiKey) {
      // The orchestrator only calls configured providers, but fail loudly rather
      // than silently returning empty results if this is ever invoked directly.
      throw new Error("coreAdapter.search called without CORE_API_KEY configured");
    }

    const limit = Math.min(options.perPage ?? 20, 100);
    const page = options.page ?? 1;
    const offset = (page - 1) * limit;

    const url = new URL(BASE_URL);
    url.searchParams.set("q", options.query);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));

    if (!options.signal) {
      throw new Error("coreAdapter.search requires an AbortSignal");
    }

    const response = await fetch(url, {
      signal: options.signal,
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) {
      throw new Error(`Request to ${url} failed with status ${response.status}`);
    }
    const data = (await response.json()) as CoreResponse;

    return {
      works: (data.results ?? []).map(mapCoreWork),
      totalCount: data.totalHits ?? null,
    };
  },
};
