import { cslYear, type CslItem } from "@/lib/citations/csl";

const ENTRY_TYPES: Record<string, string> = {
  "article-journal": "article",
  "paper-conference": "inproceedings",
  chapter: "incollection",
  book: "book",
  thesis: "phdthesis",
  report: "techreport",
  dataset: "misc",
  article: "article",
  document: "misc",
};

/**
 * Escapes the five characters that change meaning in a BibTeX value. A title
 * containing a bare `&` or `%` silently truncates or corrupts the entry when
 * LaTeX compiles it, and the user finds out at typeset time.
 */
export function escapeBibtex(value: string): string {
  return value.replace(/([&%$#_])/g, "\\$1");
}

/**
 * Braces capitals so BibTeX's title-casing doesn't lowercase them. Acronyms
 * and gene names are the common casualty: "DNA Methylation in BRCA1" becomes
 * "Dna methylation in brca1" without this.
 */
function protectCase(title: string): string {
  return title.replace(/\b([A-Z][A-Za-z]*[A-Z][A-Za-z0-9]*)\b/g, "{$1}");
}

/** A stable, collision-resistant key: first author surname + year + first
 * title word, ASCII-folded. Deterministic, so re-exporting the same work twice
 * produces the same key and a merged .bib file doesn't grow duplicates. */
export function bibtexKey(item: CslItem): string {
  const surname = item.author[0]?.family ?? "anon";
  const year = cslYear(item) ?? "nd";
  const word = item.title.split(/\s+/).find((w) => w.length > 3) ?? "untitled";
  return `${surname}${year}${word}`
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toLowerCase();
}

export function formatBibtex(item: CslItem): string {
  const entryType = ENTRY_TYPES[item.type] ?? "misc";
  const fields: Array<[string, string]> = [];

  const authors = item.author
    .map((a) => (a.literal ? `{${a.literal}}` : a.given ? `${a.family}, ${a.given}` : a.family))
    .join(" and ");
  if (authors) fields.push(["author", authors]);

  fields.push(["title", protectCase(escapeBibtex(item.title))]);

  const container = item["container-title"];
  if (container)
    fields.push([entryType === "inproceedings" ? "booktitle" : "journal", escapeBibtex(container)]);

  const year = cslYear(item);
  if (year) fields.push(["year", String(year)]);
  if (item.volume) fields.push(["volume", item.volume]);
  if (item.issue) fields.push(["number", item.issue]);
  // BibTeX's page separator is an en-dash written as `--`.
  if (item.page) fields.push(["pages", item.page.replace(/[-–]/, "--")]);
  if (item.publisher) fields.push(["publisher", escapeBibtex(item.publisher)]);
  if (item.DOI) fields.push(["doi", item.DOI]);
  if (item.ISSN) fields.push(["issn", item.ISSN]);
  if (item.ISBN) fields.push(["isbn", item.ISBN]);
  if (item.URL) fields.push(["url", item.URL]);

  const body = fields.map(([key, value]) => `  ${key} = {${value}}`).join(",\n");
  return `@${entryType}{${bibtexKey(item)},\n${body}\n}`;
}
