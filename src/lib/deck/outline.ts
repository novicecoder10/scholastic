import { CITATION_MARKER } from "@/lib/manuscript/draftGuard";

/**
 * A slide deck built from papers, and the guard that keeps it honest.
 *
 * The unit of a deck is a bullet, not a sentence, so this cannot simply call
 * `validateDraft`: a bullet is one claim that may run to two sentences, and
 * splitting it would strip the half that did not repeat the citation. What it
 * does share is the rule — a claim with no citation is deleted rather than
 * shown — and the marker syntax it is written in, imported rather than
 * re-declared.
 *
 * A presentation is where uncited claims do the most damage. Nobody reads a
 * slide with a reference list open; a bullet on a projector is taken on trust,
 * which is exactly why the trust has to be earned before it is rendered.
 */

export interface DeckBullet {
  /** Still carries its `[[workKey]]` markers; the renderer swaps them for
   * labels once the deck-wide citation order is known. */
  text: string;
  citations: string[];
}

export interface DeckSlide {
  title: string;
  bullets: DeckBullet[];
}

export interface DeckOutline {
  slides: DeckSlide[];
  /** Bullets deleted for carrying no citation the caller supplied. */
  droppedUncited: number;
  /** Citation markers deleted for naming a work outside the supplied set. */
  droppedForeign: number;
  /** Slides deleted because every bullet on them was dropped. */
  droppedSlides: number;
}

const HEADING = /^#{1,6}\s+(.*)$/;
const BULLET = /^\s*[-*•]\s+(.*)$/;

interface RawSlide {
  title: string;
  bullets: string[];
}

/**
 * Parses the line format the model is asked for: `## Slide title` followed by
 * `- bullet` lines.
 *
 * A line format rather than JSON, for the reason #7 already learned the hard
 * way — a free-tier model asked for strict JSON spends its budget on syntax and
 * truncates mid-object, and a deck half-parsed is a deck lost. A stray prose
 * line here costs one ignored line.
 *
 * Bullets before the first heading are dropped rather than adopted into an
 * invented slide: guessing where a claim belongs is the one thing this layer
 * must not do.
 */
export function parseOutline(raw: string): RawSlide[] {
  const slides: RawSlide[] = [];
  let current: RawSlide | null = null;

  for (const line of raw.split("\n")) {
    const heading = line.match(HEADING);
    if (heading) {
      current = { title: heading[1].trim(), bullets: [] };
      slides.push(current);
      continue;
    }
    const bullet = line.match(BULLET);
    if (bullet && current) current.bullets.push(bullet[1].trim());
  }

  return slides.filter((slide) => slide.title !== "");
}

/**
 * Strips citations naming a work the caller did not supply, deletes any bullet
 * left with none, and deletes any slide left with no bullets.
 *
 * The three rules compose in that order on purpose, the same way the
 * manuscript drafter's two do: a bullet stripped of its only citation is itself
 * uncited, and a slide whose every bullet went that way is a title with nothing
 * under it.
 */
export function validateOutline(raw: string, allowed: Iterable<string>): DeckOutline {
  const permitted = new Set(allowed);
  let droppedUncited = 0;
  let droppedForeign = 0;
  let droppedSlides = 0;

  const slides: DeckSlide[] = [];
  for (const slide of parseOutline(raw)) {
    const bullets: DeckBullet[] = [];

    for (const line of slide.bullets) {
      CITATION_MARKER.lastIndex = 0;
      const cited = [...line.matchAll(CITATION_MARKER)].map((m) => m[1].trim());
      const kept = cited.filter((key) => permitted.has(key));
      droppedForeign += cited.length - kept.length;

      if (kept.length === 0) {
        droppedUncited += 1;
        continue;
      }

      const text = line
        .replace(CITATION_MARKER, (whole, key: string) => (permitted.has(key.trim()) ? whole : ""))
        .replace(/\s{2,}/g, " ")
        .trim();
      bullets.push({ text, citations: kept });
    }

    if (bullets.length === 0) {
      droppedSlides += 1;
      continue;
    }
    slides.push({ title: slide.title, bullets });
  }

  return { slides, droppedUncited, droppedForeign, droppedSlides };
}

/**
 * Every work cited anywhere in the deck, in first-appearance order — the same
 * contract as `collectCitedWorkKeys` for a manuscript, and the same reason:
 * first appearance is what a numbered style means by "order", and the deck's
 * reference slide has to agree with its inline labels.
 */
export function collectDeckWorkKeys(outline: DeckOutline): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const slide of outline.slides) {
    for (const bullet of slide.bullets) {
      for (const key of bullet.citations) {
        if (!seen.has(key)) {
          seen.add(key);
          order.push(key);
        }
      }
    }
  }
  return order;
}

/** Splits a bullet into literal text and citation runs, so a renderer never
 * re-parses markers. Mirrors `sentenceSegments` for the same reason. */
export function bulletSegments(
  bullet: DeckBullet,
): Array<{ kind: "text"; value: string } | { kind: "citation"; workKey: string }> {
  const segments: Array<{ kind: "text"; value: string } | { kind: "citation"; workKey: string }> =
    [];
  let cursor = 0;
  CITATION_MARKER.lastIndex = 0;
  for (const match of bullet.text.matchAll(CITATION_MARKER)) {
    const start = match.index ?? 0;
    if (start > cursor) segments.push({ kind: "text", value: bullet.text.slice(cursor, start) });
    segments.push({ kind: "citation", workKey: match[1].trim() });
    cursor = start + match[0].length;
  }
  if (cursor < bullet.text.length) {
    segments.push({ kind: "text", value: bullet.text.slice(cursor) });
  }
  return segments;
}

/**
 * Rewrites every citation from the tag the model was given to the workKey it
 * stands for.
 *
 * The model is never shown a workKey. `doi:10.1038/nbt.3117` is a long string
 * with punctuation a language model paraphrases, hyphenates or truncates, and a
 * citation that comes back one character wrong is indistinguishable from an
 * invented one — the guard deletes it, and the first live run of this feature
 * lost all five slides that way. A two-character tag is copied correctly.
 *
 * The guard still runs against the tags before this, so an unknown tag is
 * already gone by the time anything is remapped.
 */
export function remapCitations(outline: DeckOutline, tags: Map<string, string>): DeckOutline {
  const slides = outline.slides.map((slide) => ({
    title: slide.title,
    bullets: slide.bullets.map((bullet) => ({
      text: bullet.text.replace(CITATION_MARKER, (whole, tag: string) => {
        const workKey = tags.get(tag.trim());
        return workKey ? `[[${workKey}]]` : whole;
      }),
      citations: bullet.citations.map((tag) => tags.get(tag) ?? tag),
    })),
  }));
  return { ...outline, slides };
}
