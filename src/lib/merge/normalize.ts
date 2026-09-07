import type { RawWorkAuthor } from "@/lib/providers/types";

const COMBINING_DIACRITICS = /[\u0300-\u036f]/g;

export function normalizeDoi(doi: string | null): string | null {
  if (!doi) return null;
  // Defence in depth behind the provider mappers. Every provider parses a
  // third-party payload, and a repeated XML element or a numeric JSON field
  // reaches here as a non-string however carefully the mapper is typed. One
  // malformed record must cost that record, not the entire merged search —
  // the same contract fan-out already keeps for a provider that is down.
  if (typeof doi !== "string") return null;
  return doi
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, "");
}

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(COMBINING_DIACRITICS, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function firstAuthorSurname(authors: RawWorkAuthor[]): string | null {
  if (authors.length === 0) return null;
  const parts = authors[0].name.trim().split(/\s+/);
  if (parts.length === 0 || parts[0] === "") return null;
  return normalizeTitle(parts[parts.length - 1]);
}
