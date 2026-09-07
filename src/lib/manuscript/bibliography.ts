import type { CanonicalWork } from "@/lib/types/work";
import { formatCitation, type CitationStyle } from "@/lib/citations";
import { CITATION_NODE, type DocNode } from "@/lib/manuscript/types";

/**
 * A citation node stores **only** a workKey. No number, no author-year string,
 * nothing about how it renders.
 *
 * That single decision is what makes the rest of this file possible:
 * reordering paragraphs renumbers automatically, switching APA to MLA is a
 * re-render rather than a rewrite, deleting a sentence removes its
 * bibliography entry, and the same work cited twice produces one entry. It is
 * also the whole reason this feature needs ProseMirror rather than a markdown
 * box.
 */
export function collectCitedWorkKeys(doc: DocNode | null | undefined): string[] {
  const seen = new Set<string>();
  const order: string[] = [];

  const walk = (node: DocNode | undefined) => {
    if (!node) return;
    if (node.type === CITATION_NODE) {
      const key = node.attrs?.workKey;
      // First appearance wins, which is what numbered styles mean by "order".
      if (typeof key === "string" && key && !seen.has(key)) {
        seen.add(key);
        order.push(key);
      }
    }
    for (const child of node.content ?? []) walk(child);
  };

  walk(doc ?? undefined);
  return order;
}

/**
 * A manuscript's citation style is a **prose** style. BibTeX and RIS are
 * interchange formats — they have no inline label and no place in a rendered
 * bibliography, and offering them here produced a markdown export whose
 * references section was a list of `@article{...}` entries.
 */
export const MANUSCRIPT_STYLES: CitationStyle[] = ["apa", "mla", "chicago"];

export function isManuscriptStyle(value: string): value is CitationStyle {
  return (MANUSCRIPT_STYLES as string[]).includes(value);
}

export interface ResolvedWork {
  workKey: string;
  work: CanonicalWork | null;
}

export const BROKEN_CITATION_LABEL = "[missing citation]";

/**
 * The inline label for a citation, given its position in the document.
 *
 * An unresolvable key renders as a visible marker rather than disappearing. A
 * citation that quietly vanishes from a manuscript is a plagiarism risk, not a
 * rendering bug — the sentence keeps the claim and loses the attribution.
 */
export function inlineLabel(
  resolved: ResolvedWork | undefined,
  index: number,
  style: CitationStyle,
): string {
  if (!resolved?.work) return BROKEN_CITATION_LABEL;

  const first = resolved.work.authors[0]?.name;
  const surname = first ? (first.split(/\s+/).pop() ?? first) : null;
  if (!surname) return `[${index + 1}]`;
  const etAl = resolved.work.authors.length > 2 ? " et al." : "";

  // MLA's in-text citation is author and page, and a bibliography has no page
  // to give — so it is author alone rather than a year MLA would not print.
  if (style === "mla") return `(${surname}${etAl})`;

  const year = resolved.work.year ?? "n.d.";
  return `(${surname}${etAl}, ${year})`;
}

export interface BibliographyEntry {
  workKey: string;
  /** Null when the work could not be resolved — rendered as a broken marker. */
  text: string | null;
  missing: boolean;
}

/**
 * Formats each cited work through #4's deterministic formatters. Zero new
 * formatting code: the manuscript is one more consumer of the CSL layer, which
 * is why a style switch here can never disagree with a Cite popover there.
 */
export function buildBibliography(
  order: string[],
  resolved: Map<string, CanonicalWork | null>,
  style: CitationStyle,
): BibliographyEntry[] {
  return order.map((workKey) => {
    const work = resolved.get(workKey) ?? null;
    if (!work) {
      return {
        workKey,
        text: null,
        missing: true,
      };
    }
    return { workKey, text: formatCitation(work, style).text, missing: false };
  });
}
