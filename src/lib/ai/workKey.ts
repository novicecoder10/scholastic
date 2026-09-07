import { createHash } from "node:crypto";
import type { RawWorkAuthor } from "@/lib/providers/types";
import { normalizeDoi, normalizeTitle, firstAuthorSurname } from "@/lib/merge/normalize";

export interface WorkIdentity {
  doi: string | null;
  title: string;
  year: number | null;
  authors: RawWorkAuthor[];
  venue: string | null;
}

/**
 * Stable identity for a work across separate HTTP requests — `CanonicalWork.id`
 * is explicitly only stable within a single search response. DOI when present
 * (hashed too, so every key is a uniform, URL-safe opaque token with no slashes
 * — a raw DOI like "10.1109/iccv..." would otherwise break a single Next.js
 * route segment). Falls back to a content hash of normalized
 * title+year+first-author-surname+venue for DOI-less works.
 *
 * The content-hash fallback requires an EXACT match on normalized title (plus
 * year and author), which is stricter than the fuzzy dedup matcher's 0.92
 * Jaro-Winkler threshold (see `merge/matcher.ts`) — two works that could
 * collide here would already have been merged into one `CanonicalWork` within
 * a single search response. The residual risk is cross-response: two distinct
 * DOI-less papers sharing byte-identical normalized title+year+author+venue
 * (e.g. two same-titled generic "Editorial" pieces). See KNOWN_LIMITATIONS.md.
 */
export function getWorkKey(work: WorkIdentity): string {
  const doi = normalizeDoi(work.doi);
  const author = firstAuthorSurname(work.authors) ?? "";
  const identity = doi
    ? `doi:${doi}`
    : `hash:${normalizeTitle(work.title)}|${work.year ?? ""}|${author}|${normalizeTitle(work.venue ?? "")}`;

  const digest = createHash("sha256").update(identity).digest("hex");
  return doi ? `doi:${digest}` : `hash:${digest}`;
}
