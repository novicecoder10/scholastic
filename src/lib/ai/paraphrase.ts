export type ParaphraseMode = "plain-language" | "concise" | "formal";

export const PARAPHRASE_MODES: Array<{ id: ParaphraseMode; label: string; hint: string }> = [
  { id: "plain-language", label: "Plain language", hint: "Fewer technical terms, same meaning" },
  { id: "concise", label: "Concise", hint: "Shorter, without dropping content" },
  { id: "formal", label: "Formal", hint: "Academic register" },
];

/** Roughly 2000 words. Counted on whitespace runs, which over-counts slightly
 * against a real tokenizer — erring toward accepting is the wrong direction
 * for a cost limit, so the loose definition is deliberate. */
export const MAX_PARAPHRASE_WORDS = 2000;

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

export function isValidParaphraseMode(value: unknown): value is ParaphraseMode {
  return value === "plain-language" || value === "concise" || value === "formal";
}

const MODE_INSTRUCTIONS: Record<ParaphraseMode, string> = {
  "plain-language":
    "Rewrite it in plain language: replace jargon with ordinary words where an ordinary word " +
    "exists, and break long sentences apart. Keep every technical term that has no plain " +
    "equivalent.",
  concise:
    "Rewrite it more concisely: remove redundancy and filler. Do not remove content — if a " +
    "sentence carries a distinct point, that point must survive.",
  formal:
    "Rewrite it in a formal academic register: no contractions, no colloquialisms, consistent " +
    "third person.",
};

/**
 * The three constraints below are correctness requirements, not style
 * preferences, and they are why this is a scoped tool rather than a general
 * rewriter:
 *
 * - Dropping "(Smith 2019)" silently destroys attribution.
 * - Adding a specific the source didn't contain is fabrication in the user's
 *   own voice, which is worse than fabrication in the assistant's.
 * - Turning "may suggest" into "shows" is a factual error in academic prose,
 *   not a tightening. It is also the failure a general-purpose rewriter
 *   produces most reliably, so the prompt names it outright.
 */
export function buildParaphrasePrompt(mode: ParaphraseMode): string {
  return (
    "You rewrite academic prose that the user wrote themselves. " +
    MODE_INSTRUCTIONS[mode] +
    "\n\nThree rules override the instruction above whenever they conflict with it:\n" +
    "1. Preserve every citation marker verbatim — (Smith, 2019), [12], (see Jones et al.). " +
    "Keep it attached to the same claim it was attached to.\n" +
    "2. Add no claims. Do not introduce a number, finding, mechanism or specific that the " +
    "source text does not contain.\n" +
    "3. Preserve hedging exactly. 'may suggest' must not become 'shows'; 'was associated with' " +
    "must not become 'caused'. Strengthening a hedge is a factual error, not an improvement.\n\n" +
    "Output only the rewritten text. No preamble, no explanation, no commentary."
  );
}
