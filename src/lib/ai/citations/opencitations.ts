import { withResilience } from "@/lib/resilience/withResilience";
import type { CitationRef } from "@/lib/ai/citations/types";

const BASE_URL = "https://opencitations.net/index/coci/api/v1";

interface CociItem {
  citing: string;
  cited: string;
}

function buildHeaders(): Record<string, string> {
  const token = process.env.OPENCITATIONS_ACCESS_TOKEN;
  return token ? { authorization: token } : {};
}

/**
 * OpenCitations' COCI API is by-DOI only (no keyword search — see
 * KNOWN_LIMITATIONS.md's note on why it's excluded from the search fan-out),
 * which is exactly the shape citation enrichment needs: given an
 * already-identified paper's DOI, who cites it and what does it cite. Returns
 * bare DOIs only (no title/year — COCI doesn't have them); Semantic Scholar's
 * citation endpoints fill that gap where available (see semanticScholar.ts).
 */
export async function getOpenCitationsCitingWorks(doi: string): Promise<CitationRef[]> {
  return withResilience("opencitations_citations", async (ctx) => {
    const response = await fetch(`${BASE_URL}/citations/${encodeURIComponent(doi)}`, {
      signal: ctx.signal,
      headers: buildHeaders(),
    });
    if (!response.ok) {
      throw new Error(`OpenCitations citations request failed with status ${response.status}`);
    }
    const items = (await response.json()) as CociItem[];
    return items.map((item) => ({ doi: item.citing, title: null, year: null }));
  });
}

export async function getOpenCitationsReferences(doi: string): Promise<CitationRef[]> {
  return withResilience("opencitations_references", async (ctx) => {
    const response = await fetch(`${BASE_URL}/references/${encodeURIComponent(doi)}`, {
      signal: ctx.signal,
      headers: buildHeaders(),
    });
    if (!response.ok) {
      throw new Error(`OpenCitations references request failed with status ${response.status}`);
    }
    const items = (await response.json()) as CociItem[];
    return items.map((item) => ({ doi: item.cited, title: null, year: null }));
  });
}
