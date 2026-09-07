import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { readFileSync } from "node:fs";
import path from "node:path";
import { server } from "@/test/msw-server";
import { arxivAdapter } from "@/lib/providers/arxiv/adapter";
import { mapArxivEntry } from "@/lib/providers/arxiv/mapper";

const fixtureXml = readFileSync(
  path.join(process.cwd(), "src/test/fixtures/arxiv-search.atom.xml"),
  "utf-8",
);

describe("arxivAdapter", () => {
  it("is always configured (no credentials required)", () => {
    expect(arxivAdapter.isConfigured()).toBe(true);
    expect(arxivAdapter.meta.requiresCredential).toBe(false);
  });

  it("parses the Atom XML feed into the common RawWork shape", async () => {
    server.use(
      http.get("http://export.arxiv.org/api/query", () => {
        return new HttpResponse(fixtureXml, {
          headers: { "Content-Type": "application/atom+xml" },
        });
      }),
    );

    const result = await arxivAdapter.search({
      query: "transformers",
      signal: new AbortController().signal,
    });

    expect(result.totalCount).toBe(2);
    expect(result.works).toHaveLength(2);

    const [first, second] = result.works;
    expect(first.sourceId).toBe("arxiv");
    expect(first.sourceRecordId).toBe("1706.03762v5");
    expect(first.doi).toBe("10.48550/arXiv.1706.03762");
    expect(first.title).toBe("Attention Is All You Need");
    expect(first.abstract).toContain("dominant sequence transduction models");
    expect(first.authors).toEqual([{ name: "Ashish Vaswani" }, { name: "Noam Shazeer" }]);
    expect(first.year).toBe(2017);
    expect(first.venue).toBe("arXiv");
    expect(first.isOpenAccess).toBe(true);
    expect(first.pdfUrl).toBe("http://arxiv.org/pdf/1706.03762v5");
    expect(first.landingPageUrl).toBe("http://arxiv.org/abs/1706.03762v5");

    expect(second.doi).toBeNull();
    expect(second.authors).toEqual([{ name: "Jane Researcher" }]);
  });
});

describe("mapArxivEntry: repeated Atom elements", () => {
  it("takes the first value when arXiv repeats the DOI element", () => {
    // A real record from the "sleep deprivation" results carries four
    // identical <arxiv:doi> elements. The parser collapses them to an array,
    // which used to reach normalizeDoi and 500 the whole search.
    const work = mapArxivEntry({
      id: "http://arxiv.org/abs/1234.5678v1",
      title: "Sleep Deprivation Attack Detection",
      "arxiv:doi": ["10.5120/5056-7374", "10.5120/5056-7374"],
    } as never);
    expect(work.doi).toBe("10.5120/5056-7374");
  });

  it("takes the first value when the title or summary repeats", () => {
    const work = mapArxivEntry({
      id: "http://arxiv.org/abs/1234.5678v1",
      title: ["A  spaced   title", "A duplicate"],
      summary: ["An   abstract", "A duplicate"],
    } as never);
    expect(work.title).toBe("A spaced title");
    expect(work.abstract).toBe("An abstract");
  });

  it("is null rather than an empty string when a repeated DOI is all blanks", () => {
    const work = mapArxivEntry({
      id: "http://arxiv.org/abs/1234.5678v1",
      title: "T",
      "arxiv:doi": ["", "  "],
    } as never);
    expect(work.doi).toBeNull();
  });
});
