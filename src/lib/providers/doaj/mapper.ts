import type { RawWork, RawWorkAuthor } from "@/lib/providers/types";

export interface DoajIdentifier {
  type: string;
  id: string;
}

export interface DoajLink {
  type: string;
  url: string;
}

export interface DoajBibjson {
  title: string;
  author?: { name: string }[];
  journal?: { title?: string };
  year?: string;
  abstract?: string;
  identifier?: DoajIdentifier[];
  link?: DoajLink[];
}

export interface DoajArticle {
  id: string;
  bibjson: DoajBibjson;
}

export interface DoajResponse {
  total: number;
  results: DoajArticle[];
}

function findDoi(identifiers: DoajIdentifier[] | undefined): string | null {
  return identifiers?.find((i) => i.type === "doi")?.id ?? null;
}

function findFulltextUrl(links: DoajLink[] | undefined): string | null {
  return links?.find((l) => l.type === "fulltext")?.url ?? null;
}

export function mapDoajArticle(article: DoajArticle): RawWork {
  const { bibjson } = article;
  const authors: RawWorkAuthor[] = (bibjson.author ?? []).map((a) => ({ name: a.name }));
  const doi = findDoi(bibjson.identifier);
  const fulltextUrl = findFulltextUrl(bibjson.link);

  return {
    sourceId: "doaj",
    sourceRecordId: article.id,
    doi,
    title: bibjson.title,
    abstract: bibjson.abstract ?? null,
    authors,
    year: bibjson.year ? Number.parseInt(bibjson.year, 10) : null,
    venue: bibjson.journal?.title ?? null,
    citationCount: null,
    // DOAJ = Directory of Open Access Journals — every listed article is open access by definition.
    isOpenAccess: true,
    pdfUrl: fulltextUrl,
    landingPageUrl:
      fulltextUrl ?? (doi ? `https://doi.org/${doi}` : `https://doaj.org/article/${article.id}`),
    raw: article,
  };
}
