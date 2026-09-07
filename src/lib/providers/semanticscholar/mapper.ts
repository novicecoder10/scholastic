import type { RawWork, RawWorkAuthor } from "@/lib/providers/types";

export interface SemanticScholarAuthor {
  name: string;
  externalIds?: { ORCID?: string };
}

export interface SemanticScholarPaper {
  paperId: string;
  title: string;
  abstract?: string | null;
  year?: number | null;
  venue?: string | null;
  citationCount?: number | null;
  openAccessPdf?: { url: string } | null;
  externalIds?: { DOI?: string };
  authors?: SemanticScholarAuthor[];
}

export interface SemanticScholarResponse {
  total: number;
  data: SemanticScholarPaper[];
}

export function mapSemanticScholarPaper(paper: SemanticScholarPaper): RawWork {
  const authors: RawWorkAuthor[] = (paper.authors ?? []).map((a) => ({
    name: a.name,
    orcid: a.externalIds?.ORCID,
  }));

  return {
    sourceId: "semantic_scholar",
    sourceRecordId: paper.paperId,
    doi: paper.externalIds?.DOI ?? null,
    title: paper.title,
    abstract: paper.abstract ?? null,
    authors,
    year: paper.year ?? null,
    venue: paper.venue ?? null,
    citationCount: paper.citationCount ?? null,
    isOpenAccess: paper.openAccessPdf != null,
    pdfUrl: paper.openAccessPdf?.url ?? null,
    landingPageUrl: `https://www.semanticscholar.org/paper/${paper.paperId}`,
    raw: paper,
  };
}
