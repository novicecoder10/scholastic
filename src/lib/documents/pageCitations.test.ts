import { describe, it, expect } from "vitest";
import { splitPageCitations } from "@/lib/documents/pageCitations";

describe("splitPageCitations", () => {
  it("returns a single text segment when there are no citations", () => {
    expect(splitPageCitations("No citations here.")).toEqual([
      { type: "text", value: "No citations here." },
    ]);
  });

  it("returns nothing for an empty string", () => {
    expect(splitPageCitations("")).toEqual([]);
  });

  it("lifts a single citation out of surrounding text", () => {
    expect(splitPageCitations("They used ImageNet [p. 7] for pretraining.")).toEqual([
      { type: "text", value: "They used ImageNet " },
      { type: "citation", page: 7 },
      { type: "text", value: " for pretraining." },
    ]);
  });

  it("handles multiple citations", () => {
    const segments = splitPageCitations("First [p. 2] then [p. 15] last.");
    expect(segments.filter((s) => s.type === "citation")).toEqual([
      { type: "citation", page: 2 },
      { type: "citation", page: 15 },
    ]);
  });

  it("handles adjacent citations with no text between them", () => {
    expect(splitPageCitations("[p. 3][p. 4]")).toEqual([
      { type: "citation", page: 3 },
      { type: "citation", page: 4 },
    ]);
  });

  it("accepts a page range and cites its first page", () => {
    expect(splitPageCitations("see [pp. 12-14]")).toEqual([
      { type: "text", value: "see " },
      { type: "citation", page: 12 },
    ]);
  });

  it("accepts the no-space form", () => {
    expect(splitPageCitations("[p.9]")).toEqual([{ type: "citation", page: 9 }]);
  });

  it("leaves a malformed citation as literal text rather than swallowing it", () => {
    for (const malformed of ["[p. ]", "[p. abc]", "[page 7]", "[p 7]"]) {
      expect(splitPageCitations(malformed)).toEqual([{ type: "text", value: malformed }]);
    }
  });

  it("treats a citation truncated by a streaming chunk boundary as plain text", () => {
    // Mid-stream the panel re-renders on every chunk, so it will see "[p. 1"
    // before it ever sees "[p. 12]". The partial must not throw or half-match.
    expect(splitPageCitations("as shown [p. 1")).toEqual([
      { type: "text", value: "as shown [p. 1" },
    ]);
    expect(splitPageCitations("as shown [p. 12]")).toEqual([
      { type: "text", value: "as shown " },
      { type: "citation", page: 12 },
    ]);
  });

  it("is not affected by the shared regex's lastIndex across calls", () => {
    const first = splitPageCitations("a [p. 1] b");
    const second = splitPageCitations("a [p. 1] b");
    expect(second).toEqual(first);
  });
});
