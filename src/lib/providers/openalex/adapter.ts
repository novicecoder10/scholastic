import type { ProviderAdapter, RawSearchResult, SearchOptions } from "@/lib/providers/types";
import { fetchJson } from "@/lib/providers/fetchJson";
import { mapOpenAlexWork, type OpenAlexResponse } from "@/lib/providers/openalex/mapper";

const BASE_URL = "https://api.openalex.org/works";

export const openAlexAdapter: ProviderAdapter = {
  meta: {
    id: "openalex",
    displayName: "OpenAlex",
    requiresCredential: false,
    isEnabled: true,
  },

  isConfigured() {
    return true;
  },

  async search(options: SearchOptions): Promise<RawSearchResult> {
    const perPage = Math.min(options.perPage ?? 20, 50);
    const page = options.page ?? 1;

    const url = new URL(BASE_URL);
    url.searchParams.set("search", options.query);
    url.searchParams.set("per-page", String(perPage));
    url.searchParams.set("page", String(page));
    if (options.yearFrom || options.yearTo) {
      const from = options.yearFrom ?? 1000;
      const to = options.yearTo ?? new Date().getFullYear();
      url.searchParams.set("filter", `publication_year:${from}-${to}`);
    }
    // "Polite pool" — optional, purely improves OpenAlex's rate-limit treatment.
    if (process.env.OPENALEX_EMAIL) {
      url.searchParams.set("mailto", process.env.OPENALEX_EMAIL);
    }

    if (!options.signal) {
      throw new Error("openAlexAdapter.search requires an AbortSignal");
    }

    const { data } = await fetchJson<OpenAlexResponse>(url, { signal: options.signal });

    return {
      works: data.results.map(mapOpenAlexWork),
      totalCount: data.meta?.count ?? null,
    };
  },
};
