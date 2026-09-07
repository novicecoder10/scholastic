import type { ProviderAdapter, RawSearchResult, SearchOptions } from "@/lib/providers/types";
import { fetchJson } from "@/lib/providers/fetchJson";
import { mapUnpaywallResult, type UnpaywallSearchResponse } from "@/lib/providers/unpaywall/mapper";

const BASE_URL = "https://api.unpaywall.org/v2/search";

export const unpaywallAdapter: ProviderAdapter = {
  meta: {
    id: "unpaywall",
    displayName: "Unpaywall",
    requiresCredential: true,
    get isEnabled() {
      return unpaywallAdapter.isConfigured();
    },
  },

  isConfigured() {
    return Boolean(process.env.UNPAYWALL_EMAIL);
  },

  async search(options: SearchOptions): Promise<RawSearchResult> {
    const email = process.env.UNPAYWALL_EMAIL;
    if (!email) {
      throw new Error("unpaywallAdapter.search called without UNPAYWALL_EMAIL configured");
    }

    const page = options.page ?? 1;

    const url = new URL(BASE_URL);
    url.searchParams.set("query", options.query);
    // Unpaywall's usage policy requires an identifying email on every request —
    // not a secret, just a contact address.
    url.searchParams.set("email", email);
    url.searchParams.set("page", String(page));

    if (!options.signal) {
      throw new Error("unpaywallAdapter.search requires an AbortSignal");
    }

    const { data } = await fetchJson<UnpaywallSearchResponse>(url, { signal: options.signal });

    return {
      works: (data.results ?? []).map(mapUnpaywallResult),
      totalCount: data.total_results ?? null,
    };
  },
};
