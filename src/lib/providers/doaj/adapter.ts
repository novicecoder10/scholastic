import type { ProviderAdapter, RawSearchResult, SearchOptions } from "@/lib/providers/types";
import { fetchJson } from "@/lib/providers/fetchJson";
import { mapDoajArticle, type DoajResponse } from "@/lib/providers/doaj/mapper";

const BASE_URL = "https://doaj.org/api/search/articles";

export const doajAdapter: ProviderAdapter = {
  meta: {
    id: "doaj",
    displayName: "DOAJ",
    requiresCredential: false,
    isEnabled: true,
  },

  isConfigured() {
    return true;
  },

  async search(options: SearchOptions): Promise<RawSearchResult> {
    const pageSize = Math.min(options.perPage ?? 20, 50);
    const page = options.page ?? 1;

    // DOAJ's query string is a path segment, not a query param, and supports its
    // own mini query language; a bare term searches across bibjson fields.
    let query = options.query;
    if (options.yearFrom || options.yearTo) {
      const from = options.yearFrom ?? 1000;
      const to = options.yearTo ?? new Date().getFullYear();
      query += ` AND bibjson.year:[${from} TO ${to}]`;
    }

    const url = new URL(`${BASE_URL}/${encodeURIComponent(query)}`);
    url.searchParams.set("page", String(page));
    url.searchParams.set("pageSize", String(pageSize));

    if (!options.signal) {
      throw new Error("doajAdapter.search requires an AbortSignal");
    }

    const { data } = await fetchJson<DoajResponse>(url, { signal: options.signal });

    return {
      works: (data.results ?? []).map(mapDoajArticle),
      totalCount: data.total ?? null,
    };
  },
};
