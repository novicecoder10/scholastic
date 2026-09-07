import { withResilience } from "@/lib/resilience/withResilience";
import type { CitationRef } from "@/lib/ai/citations/types";

const BASE_URL = "https://api.semanticscholar.org/graph/v1/paper";
const FIELDS = "title,year,externalIds";

interface S2PaperRef {
  title?: string | null;
  year?: number | null;
  externalIds?: { DOI?: string };
}

interface S2CitationEdge {
  citingPaper?: S2PaperRef;
}

interface S2ReferenceEdge {
  citedPaper?: S2PaperRef;
}

function toCitationRef(paper: S2PaperRef): CitationRef {
  return {
    doi: paper.externalIds?.DOI ?? null,
    title: paper.title ?? null,
    year: paper.year ?? null,
  };
}

function authHeaders(): Record<string, string> {
  return process.env.SEMANTIC_SCHOLAR_API_KEY
    ? { "x-api-key": process.env.SEMANTIC_SCHOLAR_API_KEY }
    : {};
}

/**
 * Citation-detail extension beyond the search adapter's aggregate
 * `citationCount` — "who cites this paper" and "what does it cite," resolved
 * by DOI (S2 accepts `DOI:<doi>` as a paper id). Complements OpenCitations,
 * which is by-DOI-only but title/year-less; S2 fills in titles where covered.
 */
export async function getSemanticScholarCitingWorks(doi: string): Promise<CitationRef[]> {
  return withResilience("semantic_scholar_citations", async (ctx) => {
    const url = new URL(`${BASE_URL}/DOI:${encodeURIComponent(doi)}/citations`);
    url.searchParams.set("fields", FIELDS);
    const response = await fetch(url, { signal: ctx.signal, headers: authHeaders() });
    if (!response.ok) {
      throw new Error(`Semantic Scholar citations request failed with status ${response.status}`);
    }
    const data = (await response.json()) as { data?: S2CitationEdge[] };
    return (data.data ?? [])
      .map((edge) => edge.citingPaper)
      .filter((paper): paper is S2PaperRef => paper != null)
      .map(toCitationRef);
  });
}

export async function getSemanticScholarReferences(doi: string): Promise<CitationRef[]> {
  return withResilience("semantic_scholar_references", async (ctx) => {
    const url = new URL(`${BASE_URL}/DOI:${encodeURIComponent(doi)}/references`);
    url.searchParams.set("fields", FIELDS);
    const response = await fetch(url, { signal: ctx.signal, headers: authHeaders() });
    if (!response.ok) {
      throw new Error(`Semantic Scholar references request failed with status ${response.status}`);
    }
    const data = (await response.json()) as { data?: S2ReferenceEdge[] };
    return (data.data ?? [])
      .map((edge) => edge.citedPaper)
      .filter((paper): paper is S2PaperRef => paper != null)
      .map(toCitationRef);
  });
}

/**
 * Targeted single-paper lookup for citation *reasoning* (explaining one
 * specific citation relationship) — deliberately not added to `CitationRef`/
 * the bulk citing-/references-list `fields` param above, which would fetch
 * and cache an abstract for every edge in a possibly-hundred-item list when
 * only the one edge a user clicks into ever needs it. Returns null (not a
 * throw) when the paper isn't found or has no abstract on record — a normal,
 * expected state, not a failure.
 */
export async function getSemanticScholarAbstract(doi: string): Promise<string | null> {
  return withResilience("semantic_scholar_abstract", async (ctx) => {
    const url = new URL(`${BASE_URL}/DOI:${encodeURIComponent(doi)}`);
    url.searchParams.set("fields", "abstract");
    const response = await fetch(url, { signal: ctx.signal, headers: authHeaders() });
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`Semantic Scholar paper lookup failed with status ${response.status}`);
    }
    const data = (await response.json()) as { abstract?: string | null };
    return data.abstract ?? null;
  });
}
