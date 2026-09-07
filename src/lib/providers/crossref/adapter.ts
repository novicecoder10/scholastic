import type { ProviderAdapter, RawSearchResult, SearchOptions } from "@/lib/providers/types";
import { fetchJson } from "@/lib/providers/fetchJson";
import { mapCrossrefItem, type CrossrefResponse } from "@/lib/providers/crossref/mapper";

const BASE_URL = "https://api.crossref.org/works";

export const crossrefAdapter: ProviderAdapter = {
  meta: {
    id: "crossref",
    displayName: "Crossref",
    requiresCredential: false,
    isEnabled: true,
  },

  isConfigured() {
    return true;
  },

  async search(options: SearchOptions): Promise<RawSearchResult> {
    const perPage = Math.min(options.perPage ?? 20, 50);
    const page = options.page ?? 1;
    const offset = (page - 1) * perPage;

    const url = new URL(BASE_URL);
    url.searchParams.set("query", options.query);
    url.searchParams.set("rows", String(perPage));
    url.searchParams.set("offset", String(offset));
    if (options.yearFrom) {
      url.searchParams.set("filter", `from-pub-date:${options.yearFrom}-01-01`);
    }
    if (options.yearTo) {
      const existing = url.searchParams.get("filter");
      const toFilter = `until-pub-date:${options.yearTo}-12-31`;
      url.searchParams.set("filter", existing ? `${existing},${toFilter}` : toFilter);
    }
    // "Polite pool" — optional, purely improves Crossref's rate-limit treatment.
    if (process.env.CROSSREF_EMAIL) {
      url.searchParams.set("mailto", process.env.CROSSREF_EMAIL);
    }

    if (!options.signal) {
      throw new Error("crossrefAdapter.search requires an AbortSignal");
    }

    const { data } = await fetchJson<CrossrefResponse>(url, { signal: options.signal });

    return {
      works: data.message.items.map(mapCrossrefItem),
      totalCount: data.message["total-results"] ?? null,
    };
  },
};
