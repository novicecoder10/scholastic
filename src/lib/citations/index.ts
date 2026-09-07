import { cslYear, toCsl, type CslItem } from "@/lib/citations/csl";
import { formatApa } from "@/lib/citations/format/apa";
import { formatBibtex } from "@/lib/citations/format/bibtex";
import { formatChicago } from "@/lib/citations/format/chicago";
import { formatMla } from "@/lib/citations/format/mla";
import { formatRis } from "@/lib/citations/format/ris";
import type { CanonicalWork } from "@/lib/types/work";

export type CitationStyle = "apa" | "mla" | "chicago" | "bibtex" | "ris";

export const CITATION_STYLES: Array<{ id: CitationStyle; label: string }> = [
  { id: "apa", label: "APA" },
  { id: "mla", label: "MLA" },
  { id: "chicago", label: "Chicago" },
  { id: "bibtex", label: "BibTeX" },
  { id: "ris", label: "RIS" },
];

const FORMATTERS: Record<CitationStyle, (item: CslItem) => string> = {
  apa: formatApa,
  mla: formatMla,
  chicago: formatChicago,
  bibtex: formatBibtex,
  ris: formatRis,
};

/** Fields a style needs to render a complete journal-article entry. Export
 * formats are excluded: BibTeX and RIS are lossless containers, so a sparse
 * entry is a faithful record rather than an incomplete citation. */
const REQUIRED: Partial<Record<CitationStyle, Array<keyof CslItem>>> = {
  apa: ["author", "issued", "container-title", "volume", "page"],
  mla: ["author", "issued", "container-title", "page"],
  chicago: ["author", "issued", "container-title", "volume", "page"],
};

const FIELD_LABELS: Partial<Record<keyof CslItem, string>> = {
  author: "author list",
  issued: "publication year",
  "container-title": "journal or book title",
  volume: "volume",
  issue: "issue",
  page: "page range",
  publisher: "publisher",
};

export interface CitationResult {
  style: CitationStyle;
  text: string;
  /** Which required fields the source data didn't provide. Empty when the
   * citation is complete. */
  missing: Array<keyof CslItem>;
  /** A sentence naming the gap, or null. Rendered next to the citation rather
   * than suppressing it — a partial citation the user can finish by hand beats
   * either an invented volume or a blank panel. */
  note: string | null;
}

function isMissing(item: CslItem, field: keyof CslItem): boolean {
  const value = item[field];
  if (field === "author") return (value as CslItem["author"]).length === 0;
  if (field === "issued") return cslYear(item) === null;
  return value === null || value === undefined || value === "";
}

/**
 * Which required fields are absent for this style.
 *
 * A preprint is exempted from volume/issue/page: those don't exist for a
 * preprint, so reporting them as missing would train the user to ignore the
 * note — and a note nobody reads is worse than none.
 */
export function findMissingFields(item: CslItem, style: CitationStyle): Array<keyof CslItem> {
  const required = REQUIRED[style];
  if (!required) return [];

  const isPreprint = item.type === "article" || item["container-title"] === null;
  return required.filter((field) => {
    if (isPreprint && (field === "volume" || field === "issue" || field === "page")) return false;
    return isMissing(item, field);
  });
}

function noteFor(missing: Array<keyof CslItem>): string | null {
  if (missing.length === 0) return null;
  const names = missing.map((field) => FIELD_LABELS[field] ?? String(field));
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `Incomplete: no ${list} found for this record. Check the source before submitting.`;
}

/** Deterministic end to end. No LLM is involved anywhere in citation
 * generation: a citation that is plausibly wrong is worse than one that
 * visibly admits a gap. */
export function formatCitation(work: CanonicalWork, style: CitationStyle): CitationResult {
  const item = toCsl(work);
  const missing = findMissingFields(item, style);
  return { style, text: FORMATTERS[style](item), missing, note: noteFor(missing) };
}

export function formatAllStyles(work: CanonicalWork): Record<CitationStyle, CitationResult> {
  return Object.fromEntries(
    CITATION_STYLES.map(({ id }) => [id, formatCitation(work, id)]),
  ) as Record<CitationStyle, CitationResult>;
}
