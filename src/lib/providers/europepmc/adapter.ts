import type { ProviderAdapter, RawSearchResult, SearchOptions } from "@/lib/providers/types";
import { fetchJson } from "@/lib/providers/fetchJson";
import { mapEuropePmcResult, type EuropePmcResponse } from "@/lib/providers/europepmc/mapper";

const BASE_URL = "https://www.ebi.ac.uk/europepmc/webservices/rest/search";

export const europePmcAdapter: ProviderAdapter = {
  meta: {
    id: "europepmc",
    displayName: "Europe PMC",
    requiresCredential: false,
    isEnabled: true,
  },

  isConfigured() {
    return true;
  },

  async search(options: SearchOptions): Promise<RawSearchResult> {
    const pageSize = Math.min(options.perPage ?? 20, 50);
    const page = options.page ?? 1;

    let query = options.query;
    if (options.yearFrom || options.yearTo) {
      const from = options.yearFrom ?? 1000;
      const to = options.yearTo ?? new Date().getFullYear();
      query += ` AND PUB_YEAR:[${from} TO ${to}]`;
    }

    const url = new URL(BASE_URL);
    url.searchParams.set("query", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("pageSize", String(pageSize));
    // resultType=core is required to get abstractText; "lite" (the default) omits it.
    url.searchParams.set("resultType", "core");
    if (page > 1) {
      url.searchParams.set("cursorMark", String((page - 1) * pageSize));
    }

    if (!options.signal) {
      throw new Error("europePmcAdapter.search requires an AbortSignal");
    }

    const { data } = await fetchJson<EuropePmcResponse>(url, { signal: options.signal });

    return {
      works: (data.resultList.result ?? []).map(mapEuropePmcResult),
      totalCount: data.hitCount ?? null,
    };
  },
};
