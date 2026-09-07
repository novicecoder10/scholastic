import { createHash } from "node:crypto";
import type { CitationRef } from "@/lib/graph/model";

export interface ResolvedRef {
  workKey: string;
  /** False means provisional: the node is dimmed and not expandable. */
  resolved: boolean;
  doi: string | null;
  title: string | null;
  year: number | null;
}

/**
 * A citation reference becomes the app's own work identity, so a graph node and
 * a search result are the same thing.
 *
 * The feared per-node lookup cost largely does not exist: most citation refs
 * carry a DOI, and `doi:<normalised>` needs no lookup at all. Only the DOI-less
 * tail needs matching, and this function keeps that path honest by refusing to
 * guess — an unmatched ref gets a stable hashed id and `resolved: false`.
 *
 * One id shape carrying a flag, not two id shapes: everything downstream can
 * treat every node the same way and check one boolean where it matters.
 */
export function resolveRef(ref: CitationRef): ResolvedRef {
  const doi = normaliseDoi(ref.doi);
  if (doi) {
    return { workKey: `doi:${doi}`, resolved: true, doi, title: ref.title, year: ref.year };
  }

  // Deliberately not the app's `title:` workKey shape. That shape means "a work
  // we have seen and normalised"; this is a reference we could not resolve, and
  // conflating them would let an unresolved node silently claim to be a work.
  const fingerprint = createHash("sha256")
    .update(`${(ref.title ?? "").trim().toLowerCase()}|${ref.year ?? ""}`)
    .digest("hex")
    .slice(0, 24);

  return {
    workKey: `unresolved:${fingerprint}`,
    resolved: false,
    doi: null,
    title: ref.title,
    year: ref.year,
  };
}

/** Matches the normalisation `lib/ai/workKey.ts` applies, so a graph node and a
 * search result for the same paper carry the same key. */
function normaliseDoi(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, "")
    .replace(/^doi:/, "");
  return trimmed || null;
}

export function isUnresolved(workKey: string): boolean {
  return workKey.startsWith("unresolved:");
}
