import { describe, it, expect } from "vitest";
import { parseDraft, sentenceSegments, splitSentences, validateDraft } from "@/lib/manuscript/draftGuard";

const ALLOWED = ["k1", "k2"];

describe("splitSentences", () => {
  it("splits on sentence-ending punctuation", () => {
    expect(splitSentences("One. Two! Three?")).toEqual(["One.", "Two!", "Three?"]);
  });

  it("ignores empty input", () => {
    expect(splitSentences("   ")).toEqual([]);
  });
});

describe("parseDraft", () => {
  it("pulls the workKeys out of each sentence", () => {
    const [first] = parseDraft("Sleep consolidates memory [[k1]].");
    expect(first.citations).toEqual(["k1"]);
  });

  it("handles several citations in one sentence", () => {
    const [first] = parseDraft("Two studies agree [[k1]] [[k2]].");
    expect(first.citations).toEqual(["k1", "k2"]);
  });
});

describe("validateDraft", () => {
  it("keeps a properly cited draft intact", () => {
    const result = validateDraft("Sleep consolidates memory [[k1]]. Naps help too [[k2]].", ALLOWED);
    expect(result.sentences).toHaveLength(2);
    expect(result.droppedUncited).toBe(0);
    expect(result.droppedForeign).toBe(0);
  });

  it("strips a sentence with no citation", () => {
    // The rule that makes this a grounded draft rather than prose generation.
    const result = validateDraft("This is a broad claim. Sleep helps [[k1]].", ALLOWED);
    expect(result.sentences.map((s) => s.text)).toEqual(["Sleep helps [[k1]]."]);
    expect(result.droppedUncited).toBe(1);
  });

  it("strips a citation naming a work outside the supplied set", () => {
    const result = validateDraft("A claim [[k1]] [[k99]].", ALLOWED);
    expect(result.sentences[0].citations).toEqual(["k1"]);
    expect(result.droppedForeign).toBe(1);
    // The orphan marker goes with it, rather than being left in the prose.
    expect(result.sentences[0].text).not.toContain("k99");
  });

  it("drops a sentence whose only citation was foreign", () => {
    // The two rules compose: stripping the citation leaves the sentence uncited,
    // so it goes too.
    const result = validateDraft("An invented claim [[k99]].", ALLOWED);
    expect(result.sentences).toEqual([]);
    expect(result.droppedForeign).toBe(1);
    expect(result.droppedUncited).toBe(1);
  });

  it("returns nothing at all for a wholly uncited draft", () => {
    // The caller inserts nothing and says why, which beats putting
    // unattributed prose into someone's manuscript.
    const result = validateDraft("A confident paragraph with no sources whatsoever.", ALLOWED);
    expect(result.sentences).toEqual([]);
  });

  it("accepts an empty allowed set by keeping nothing", () => {
    expect(validateDraft("A claim [[k1]].", []).sentences).toEqual([]);
  });
});

describe("sentenceSegments", () => {
  it("splits a sentence into text and citation runs", () => {
    const [sentence] = validateDraft("Sleep helps [[k1]] a lot.", ALLOWED).sentences;
    expect(sentenceSegments(sentence)).toEqual([
      { kind: "text", value: "Sleep helps " },
      { kind: "citation", workKey: "k1" },
      { kind: "text", value: " a lot." },
    ]);
  });

  it("handles a sentence ending in a citation", () => {
    const [sentence] = validateDraft("Sleep helps [[k1]]", ALLOWED).sentences;
    expect(sentenceSegments(sentence).at(-1)).toEqual({ kind: "citation", workKey: "k1" });
  });
});
