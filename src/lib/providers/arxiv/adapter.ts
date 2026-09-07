import { XMLParser } from "fast-xml-parser";
import type { ProviderAdapter, RawSearchResult, SearchOptions } from "@/lib/providers/types";
import { mapArxivEntry, type ArxivFeed } from "@/lib/providers/arxiv/mapper";

const BASE_URL = "http://export.arxiv.org/api/query";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) => ["entry", "author", "link", "category"].includes(name),
});

export const arxivAdapter: ProviderAdapter = {
  meta: {
    id: "arxiv",
    displayName: "arXiv",
    requiresCredential: false,
    isEnabled: true,
  },

  isConfigured() {
    return true;
  },

  async search(options: SearchOptions): Promise<RawSearchResult> {
    const perPage = Math.min(options.perPage ?? 20, 50);
    const page = options.page ?? 1;
    const start = (page - 1) * perPage;

    const url = new URL(BASE_URL);
    url.searchParams.set("search_query", `all:${options.query}`);
    url.searchParams.set("start", String(start));
    url.searchParams.set("max_results", String(perPage));

    if (!options.signal) {
      throw new Error("arxivAdapter.search requires an AbortSignal");
    }

    const response = await fetch(url, { signal: options.signal });
    if (!response.ok) {
      throw new Error(`Request to ${url} failed with status ${response.status}`);
    }
    const xml = await response.text();
    const parsed = parser.parse(xml) as ArxivFeed;

    const entries = parsed.feed.entry ?? [];
    const totalResults = parsed.feed["opensearch:totalResults"];

    return {
      works: entries.map(mapArxivEntry),
      totalCount: typeof totalResults === "number" ? totalResults : null,
    };
  },
};
