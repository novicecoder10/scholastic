import { meteredLlm } from "@/lib/credits/metered";
import { remapCitations, validateOutline, type DeckOutline } from "@/lib/deck/outline";
import { logger } from "@/lib/log/logger";

/** Enough of an abstract to say what a paper found; past this it is method
 * detail that costs tokens the outline needs. */
const ABSTRACT_CHARS = 1200;

export interface DeckSource {
  workKey: string;
  title: string;
  abstract: string | null;
}

/**
 * The deck outline is the manuscript drafter's position applied to a different
 * artifact: it summarises sources the user chose, with attribution on every
 * claim. It is not a general-purpose slide generator, and asking it for a deck
 * about something other than the supplied papers produces an empty deck rather
 * than an invented one — the guard sees to that whatever the prompt says.
 */
const OUTLINE_PROMPT = `You are outlining a short research presentation from the papers a researcher supplied.

Output format, exactly:

## Slide title
- A bullet ending with its citation [[S1]]
- Another bullet [[S2]] [[S5]]

Rules:
- Every bullet must cite at least one paper, written as [[S1]] using the tag given for that paper. A bullet with no citation is deleted before the researcher sees it, so a claim you cannot attribute is a claim not worth making.
- Only the tags listed below. A tag that is not in the list is deleted.
- Say what the papers say. No background, implications, or recommendations they do not state.
- Where the papers disagree, give that its own bullet and cite both.
- 5 to 7 slides, 3 to 4 bullets each, one claim per bullet. Slide titles are plain noun phrases, not sentences.
- Never write "Paper 1" or a tag in the bullet text itself. Write the finding; the citation carries the attribution.
- No title slide, no agenda slide, no thank-you slide, no speaker notes. Content slides only.`;

export interface DeckResult {
  outline: DeckOutline;
  /** True when the guard emptied the deck, so the caller says why. */
  empty: boolean;
  /** The sponsor whose donated capacity answered, when they asked to be named.
   * Read after the call, since the dispatcher may have failed over. */
  sponsor: string | null;
}

export async function generateDeckOutline(
  topic: string,
  sources: DeckSource[],
): Promise<DeckResult | null> {
  if (sources.length === 0) return null;

  const metered = await meteredLlm("deck_outline", "quality");
  if (!metered) return null;

  // Tagged S1..Sn and passed in search-rank order. No embedding pass: these
  // came back ranked for this very query moments ago, and a second ranking
  // would only disagree with the list the page is about to show.
  const tags = new Map(sources.map((source, i) => [`S${i + 1}`, source.workKey]));
  const context = sources
    .map(
      (source, i) =>
        `S${i + 1} | ${source.title}\n${
          source.abstract
            ? source.abstract.slice(0, ABSTRACT_CHARS)
            : "(no abstract available — cite this only for what its title states)"
        }`,
    )
    .join("\n\n");

  const raw = await metered.provider.complete({
    model: metered.provider.models.capable,
    system: OUTLINE_PROMPT,
    messages: [
      {
        role: "user",
        content: `Presentation topic: ${topic}\n\nPapers, with the tag to cite each by:\n\n${context}`,
      },
    ],
    onUsage: metered.onUsage,
    // A deck is longer than a related-work paragraph and this is the one call
    // that has to finish: a truncated outline loses whole slides, and #4's
    // reasoning-model trap bills the trace against this budget before a single
    // slide is emitted.
    maxTokens: 3000,
  });

  const validated = validateOutline(raw, tags.keys());
  const outline = remapCitations(validated, tags);
  if (outline.droppedUncited > 0 || outline.droppedForeign > 0 || outline.droppedSlides > 0) {
    logger.info(
      {
        event: "deck_outline_filtered",
        droppedUncited: outline.droppedUncited,
        droppedForeign: outline.droppedForeign,
        droppedSlides: outline.droppedSlides,
      },
      "deck bullets removed by the citation guard",
    );
  }

  return {
    outline,
    empty: outline.slides.length === 0,
    sponsor: metered.servedSponsor(),
  };
}
