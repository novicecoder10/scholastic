import { XMLParser } from "fast-xml-parser";
import type { ProviderAdapter, RawSearchResult, SearchOptions } from "@/lib/providers/types";
import { fetchJson } from "@/lib/providers/fetchJson";
import {
  mapPubmedArticle,
  extractAbstractsByPmid,
  type EsearchResponse,
  type EsummaryResponse,
  type PubmedArticleSetXml,
} from "@/lib/providers/pubmed/mapper";

const EUTILS_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) => ["PubmedArticle", "AbstractText"].includes(name),
});

function commonParams(): Record<string, string> {
  const params: Record<string, string> = { email: process.env.NCBI_EMAIL ?? "" };
  if (process.env.NCBI_API_KEY) params.api_key = process.env.NCBI_API_KEY;
  return params;
}

export const pubmedAdapter: ProviderAdapter = {
  meta: {
    id: "pubmed",
    displayName: "PubMed",
    requiresCredential: true,
    get isEnabled() {
      return pubmedAdapter.isConfigured();
    },
    // ESearch + ESummary + EFetch is a legitimately slower round trip than a
    // single-call provider.
    defaultTimeoutMs: 10_000,
  },

  isConfigured() {
    return Boolean(process.env.NCBI_EMAIL);
  },

  async search(options: SearchOptions): Promise<RawSearchResult> {
    if (!process.env.NCBI_EMAIL) {
      throw new Error("pubmedAdapter.search called without NCBI_EMAIL configured");
    }
    if (!options.signal) {
      throw new Error("pubmedAdapter.search requires an AbortSignal");
    }

    const retmax = Math.min(options.perPage ?? 20, 100);
    const page = options.page ?? 1;
    const retstart = (page - 1) * retmax;

    const esearchUrl = new URL(`${EUTILS_BASE}/esearch.fcgi`);
    esearchUrl.searchParams.set("db", "pubmed");
    esearchUrl.searchParams.set("term", options.query);
    esearchUrl.searchParams.set("retmax", String(retmax));
    esearchUrl.searchParams.set("retstart", String(retstart));
    esearchUrl.searchParams.set("retmode", "json");
    for (const [k, v] of Object.entries(commonParams())) esearchUrl.searchParams.set(k, v);

    const { data: esearchData } = await fetchJson<EsearchResponse>(esearchUrl, {
      signal: options.signal,
    });
    const ids = esearchData.esearchresult.idlist ?? [];
    const totalCount = Number.parseInt(esearchData.esearchresult.count, 10) || 0;

    if (ids.length === 0) {
      return { works: [], totalCount };
    }

    const esummaryUrl = new URL(`${EUTILS_BASE}/esummary.fcgi`);
    esummaryUrl.searchParams.set("db", "pubmed");
    esummaryUrl.searchParams.set("id", ids.join(","));
    esummaryUrl.searchParams.set("retmode", "json");
    for (const [k, v] of Object.entries(commonParams())) esummaryUrl.searchParams.set(k, v);

    const efetchUrl = new URL(`${EUTILS_BASE}/efetch.fcgi`);
    efetchUrl.searchParams.set("db", "pubmed");
    efetchUrl.searchParams.set("id", ids.join(","));
    efetchUrl.searchParams.set("rettype", "abstract");
    efetchUrl.searchParams.set("retmode", "xml");
    for (const [k, v] of Object.entries(commonParams())) efetchUrl.searchParams.set(k, v);

    const [{ data: esummaryData }, efetchResponse] = await Promise.all([
      fetchJson<EsummaryResponse>(esummaryUrl, { signal: options.signal }),
      fetch(efetchUrl, { signal: options.signal }),
    ]);

    if (!efetchResponse.ok) {
      throw new Error(`Request to ${efetchUrl} failed with status ${efetchResponse.status}`);
    }
    const efetchXml = await efetchResponse.text();
    const abstractsByPmid = extractAbstractsByPmid(
      xmlParser.parse(efetchXml) as PubmedArticleSetXml,
    );

    const works = ids
      .map((uid) => esummaryData.result[uid])
      .filter((docSum): docSum is NonNullable<typeof docSum> => Boolean(docSum))
      .map((docSum) => mapPubmedArticle(docSum, abstractsByPmid.get(docSum.uid) ?? null));

    return { works, totalCount };
  },
};
