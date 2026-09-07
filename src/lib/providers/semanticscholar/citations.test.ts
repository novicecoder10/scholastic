import { describe, it, expect, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw-server";
import {
  getSemanticScholarCitingWorks,
  getSemanticScholarReferences,
  getSemanticScholarAbstract,
} from "@/lib/providers/semanticscholar/citations";

const ORIGINAL_KEY = process.env.SEMANTIC_SCHOLAR_API_KEY;

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.SEMANTIC_SCHOLAR_API_KEY;
  else process.env.SEMANTIC_SCHOLAR_API_KEY = ORIGINAL_KEY;
});

describe("getSemanticScholarCitingWorks", () => {
  it("maps citingPaper entries to CitationRefs with title/year/DOI", async () => {
    server.use(
      http.get("https://api.semanticscholar.org/graph/v1/paper/DOI:10.1%2Ftarget/citations", () =>
        HttpResponse.json({
          data: [
            {
              citingPaper: {
                title: "A Citing Paper",
                year: 2022,
                externalIds: { DOI: "10.1/citer" },
              },
            },
            { citingPaper: { title: "No DOI Paper", year: 2021, externalIds: {} } },
          ],
        }),
      ),
    );

    const result = await getSemanticScholarCitingWorks("10.1/target");
    expect(result).toEqual([
      { doi: "10.1/citer", title: "A Citing Paper", year: 2022 },
      { doi: null, title: "No DOI Paper", year: 2021 },
    ]);
  });

  it("filters out entries with no citingPaper at all", async () => {
    server.use(
      http.get("https://api.semanticscholar.org/graph/v1/paper/DOI:10.1%2Ftarget/citations", () =>
        HttpResponse.json({
          data: [
            { citingPaper: null },
            { citingPaper: { title: "Real", year: 2020, externalIds: {} } },
          ],
        }),
      ),
    );
    const result = await getSemanticScholarCitingWorks("10.1/target");
    expect(result).toEqual([{ doi: null, title: "Real", year: 2020 }]);
  });

  it("throws a clear error on a non-OK response", async () => {
    server.use(
      http.get("https://api.semanticscholar.org/graph/v1/paper/DOI:10.1%2Fmissing/citations", () =>
        HttpResponse.json({}, { status: 404 }),
      ),
    );
    await expect(getSemanticScholarCitingWorks("10.1/missing")).rejects.toThrow(/404/);
  });

  it("sends the API key header when configured", async () => {
    process.env.SEMANTIC_SCHOLAR_API_KEY = "test-key";
    let capturedKey: string | null = null;
    server.use(
      http.get(
        "https://api.semanticscholar.org/graph/v1/paper/DOI:10.1%2Ftarget/citations",
        ({ request }) => {
          capturedKey = request.headers.get("x-api-key");
          return HttpResponse.json({ data: [] });
        },
      ),
    );
    await getSemanticScholarCitingWorks("10.1/target");
    expect(capturedKey).toBe("test-key");
  });
});

describe("getSemanticScholarReferences", () => {
  it("maps citedPaper entries to CitationRefs", async () => {
    server.use(
      http.get("https://api.semanticscholar.org/graph/v1/paper/DOI:10.1%2Fsource/references", () =>
        HttpResponse.json({
          data: [
            {
              citedPaper: {
                title: "A Referenced Paper",
                year: 2018,
                externalIds: { DOI: "10.1/ref" },
              },
            },
          ],
        }),
      ),
    );
    const result = await getSemanticScholarReferences("10.1/source");
    expect(result).toEqual([{ doi: "10.1/ref", title: "A Referenced Paper", year: 2018 }]);
  });
});

describe("getSemanticScholarAbstract", () => {
  it("returns the paper's abstract when found", async () => {
    server.use(
      http.get("https://api.semanticscholar.org/graph/v1/paper/DOI:10.1%2Ftarget", () =>
        HttpResponse.json({ abstract: "This is the abstract." }),
      ),
    );
    const result = await getSemanticScholarAbstract("10.1/target");
    expect(result).toBe("This is the abstract.");
  });

  it("returns null when the paper has no abstract on record", async () => {
    server.use(
      http.get("https://api.semanticscholar.org/graph/v1/paper/DOI:10.1%2Ftarget", () =>
        HttpResponse.json({}),
      ),
    );
    const result = await getSemanticScholarAbstract("10.1/target");
    expect(result).toBeNull();
  });

  it("returns null (not a throw) on a 404 — paper not found is a normal, expected state", async () => {
    server.use(
      http.get("https://api.semanticscholar.org/graph/v1/paper/DOI:10.1%2Fmissing", () =>
        HttpResponse.json({}, { status: 404 }),
      ),
    );
    const result = await getSemanticScholarAbstract("10.1/missing");
    expect(result).toBeNull();
  });

  it("throws on a genuine non-404 error", async () => {
    server.use(
      http.get("https://api.semanticscholar.org/graph/v1/paper/DOI:10.1%2Ftarget", () =>
        HttpResponse.json({}, { status: 500 }),
      ),
    );
    await expect(getSemanticScholarAbstract("10.1/target")).rejects.toThrow(/500/);
  });
});
