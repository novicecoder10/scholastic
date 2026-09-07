import type { BibliographicDetail, RawWork, RawWorkAuthor } from "@/lib/providers/types";

export interface EsearchResponse {
  esearchresult: {
    count: string;
    idlist: string[];
  };
}

export interface EsummaryArticleId {
  idtype: string;
  value: string;
}

export interface EsummaryAuthor {
  name: string;
}

export interface EsummaryDocSum {
  uid: string;
  title: string;
  pubdate?: string;
  source?: string;
  fulljournalname?: string;
  authors?: EsummaryAuthor[];
  articleids?: EsummaryArticleId[];
  volume?: string;
  issue?: string;
  pages?: string;
  issn?: string;
  essn?: string;
  pubtype?: string[];
}

export interface EsummaryResponse {
  result: { uids: string[] } & Record<string, EsummaryDocSum>;
}

function extractYear(pubdate: string | undefined): number | null {
  if (!pubdate) return null;
  const match = pubdate.match(/\d{4}/);
  return match ? Number.parseInt(match[0], 10) : null;
}

function findDoi(articleIds: EsummaryArticleId[] | undefined): string | null {
  return articleIds?.find((a) => a.idtype === "doi")?.value ?? null;
}

function pubmedBibliographic(docSum: EsummaryDocSum, year: number | null): BibliographicDetail {
  const [first, last] = (docSum.pages ?? "").split(/[-–]/, 2);
  return {
    volume: docSum.volume || null,
    issue: docSum.issue || null,
    firstPage: first?.trim() || null,
    lastPage: last?.trim() ?? null,
    publisher: null,
    containerTitle: docSum.fulljournalname ?? docSum.source ?? null,
    type: docSum.pubtype?.[0] ?? null,
    // EsummaryDocSum's pubdate is free text ("2019 Mar 14", "2019 Spring"), so
    // only the year is trustworthy enough to put in a citation.
    issued: year !== null ? { year } : null,
    issn: docSum.issn || docSum.essn || null,
    isbn: null,
  };
}

export function mapPubmedArticle(docSum: EsummaryDocSum, abstract: string | null): RawWork {
  const authors: RawWorkAuthor[] = (docSum.authors ?? []).map((a) => ({ name: a.name }));
  const year = extractYear(docSum.pubdate);

  return {
    sourceId: "pubmed",
    sourceRecordId: docSum.uid,
    doi: findDoi(docSum.articleids),
    title: docSum.title,
    abstract,
    authors,
    year,
    venue: docSum.fulljournalname ?? docSum.source ?? null,
    // PubMed itself doesn't track citation counts.
    citationCount: null,
    // PubMed is a bibliographic index, not an OA/full-text signal — leave to
    // Unpaywall/Europe PMC, which specialize in that.
    isOpenAccess: null,
    pdfUrl: null,
    landingPageUrl: `https://pubmed.ncbi.nlm.nih.gov/${docSum.uid}/`,
    bibliographic: pubmedBibliographic(docSum, year),
    raw: docSum,
  };
}

/** A node's text content, whether XML parsing produced a plain string or an {@_Attr, #text} object. */
export function extractXmlText(node: unknown): string {
  if (typeof node === "string") return node;
  if (node && typeof node === "object" && "#text" in node) {
    return String((node as Record<string, unknown>)["#text"] ?? "");
  }
  return "";
}

export interface PubmedArticleXml {
  MedlineCitation: {
    PMID: unknown;
    Article?: {
      Abstract?: {
        AbstractText?: unknown[];
      };
    };
  };
}

export interface PubmedArticleSetXml {
  PubmedArticleSet?: {
    PubmedArticle?: PubmedArticleXml[];
  };
}

/** Builds a PMID -> combined abstract text map from an EFetch PubmedArticleSet document. */
export function extractAbstractsByPmid(parsed: PubmedArticleSetXml): Map<string, string> {
  const map = new Map<string, string>();
  const articles = parsed.PubmedArticleSet?.PubmedArticle ?? [];

  for (const article of articles) {
    const pmid = extractXmlText(article.MedlineCitation.PMID);
    const abstractTexts = article.MedlineCitation.Article?.Abstract?.AbstractText ?? [];
    const combined = abstractTexts.map(extractXmlText).filter(Boolean).join(" ");
    if (pmid && combined) map.set(pmid, combined);
  }

  return map;
}
