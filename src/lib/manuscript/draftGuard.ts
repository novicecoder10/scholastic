/**
 * The grounded draft's mechanical validator.
 *
 * Same pattern as #7's non-invention guards: the constraint is enforced in code
 * after generation and before insertion, so it holds regardless of what the
 * model returns. A prompt that asks for citations on every sentence is a
 * request; this is the answer.
 */

export interface DraftSentence {
  text: string;
  /** workKeys cited in this sentence, in order of appearance. */
  citations: string[];
}

/**
 * The model is asked to write citations as `[[workKey]]`, which is
 * unambiguous in prose and trivially parseable — unlike an author-year string,
 * which would have to be matched back to a work and could match the wrong one.
 *
 * Exported because the deck outline enforces the same rule one bullet at a
 * time. Two regexes for one wire format is how the two guards drift apart.
 */
export const CITATION_MARKER = /\[\[([^\]]+)\]\]/g;

/** Sentence splitting is deliberately simple: a period, question mark or
 * exclamation followed by whitespace. Academic prose has abbreviations that
 * will occasionally split wrongly, and the cost of that is one over-split
 * sentence, not a wrong citation. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseDraft(raw: string): DraftSentence[] {
  return splitSentences(raw).map((text) => {
    CITATION_MARKER.lastIndex = 0;
    const citations: string[] = [];
    for (const match of text.matchAll(CITATION_MARKER)) citations.push(match[1].trim());
    return { text, citations };
  });
}

export interface ValidatedDraft {
  sentences: DraftSentence[];
  /** Sentences dropped for having no citation. */
  droppedUncited: number;
  /** Citations dropped for naming a work outside the supplied set. */
  droppedForeign: number;
}

/**
 * Strips any sentence with no citation, and any citation naming a work the user
 * did not supply.
 *
 * A sentence stripped of its only citation is then itself uncited, so it goes
 * too — the two rules compose in that order on purpose. An emptied draft
 * inserts nothing and the caller says why, which is a better outcome than
 * inserting unattributed prose into someone's manuscript.
 */
export function validateDraft(raw: string, allowed: Iterable<string>): ValidatedDraft {
  const permitted = new Set(allowed);
  let droppedUncited = 0;
  let droppedForeign = 0;

  const sentences: DraftSentence[] = [];
  for (const sentence of parseDraft(raw)) {
    const kept = sentence.citations.filter((key) => permitted.has(key));
    droppedForeign += sentence.citations.length - kept.length;

    if (kept.length === 0) {
      droppedUncited += 1;
      continue;
    }

    // Rewrite the text so a stripped marker leaves no orphan `[[...]]` behind.
    const text = sentence.text.replace(CITATION_MARKER, (whole, key: string) =>
      permitted.has(key.trim()) ? whole : "",
    );
    sentences.push({ text: text.replace(/\s{2,}/g, " ").trim(), citations: kept });
  }

  return { sentences, droppedUncited, droppedForeign };
}

/** Splits a validated sentence into the literal text and citation runs an
 * editor needs to build inline nodes, so the caller never re-parses markers. */
export function sentenceSegments(
  sentence: DraftSentence,
): Array<{ kind: "text"; value: string } | { kind: "citation"; workKey: string }> {
  const segments: Array<{ kind: "text"; value: string } | { kind: "citation"; workKey: string }> =
    [];
  let cursor = 0;
  CITATION_MARKER.lastIndex = 0;
  for (const match of sentence.text.matchAll(CITATION_MARKER)) {
    const start = match.index ?? 0;
    if (start > cursor) segments.push({ kind: "text", value: sentence.text.slice(cursor, start) });
    segments.push({ kind: "citation", workKey: match[1].trim() });
    cursor = start + match[0].length;
  }
  if (cursor < sentence.text.length) {
    segments.push({ kind: "text", value: sentence.text.slice(cursor) });
  }
  return segments;
}
