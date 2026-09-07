import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw-server";
import { crossrefAdapter } from "@/lib/providers/crossref/adapter";
import fixture from "@/test/fixtures/crossref-search.json";

describe("crossrefAdapter", () => {
  it("is always configured (no credentials required)", () => {
    expect(crossrefAdapter.isConfigured()).toBe(true);
    expect(crossrefAdapter.meta.requiresCredential).toBe(false);
  });

  it("maps Crossref items into the common RawWork shape", async () => {
    server.use(http.get("https://api.crossref.org/works", () => HttpResponse.json(fixture)));

    const result = await crossrefAdapter.search({
      query: "example problem",
      signal: new AbortController().signal,
    });

    expect(result.totalCount).toBe(2);
    expect(result.works).toHaveLength(2);

    const [first, second] = result.works;
    expect(first.sourceId).toBe("crossref");
    expect(first.doi).toBe("10.1109/5.771073");
    expect(first.title).toBe("A Well-Known Published Paper");
    expect(first.abstract).toBe("This paper studies an important example problem.");
    expect(first.authors).toEqual([
      { name: "Jane Smith", orcid: "0000-0002-1111-2222" },
      { name: "John Doe", orcid: undefined },
    ]);
    expect(first.year).toBe(2019);
    expect(first.venue).toBe("Journal of Examples");
    expect(first.citationCount).toBe(450);
    expect(first.isOpenAccess).toBeNull();
    expect(first.pdfUrl).toBe("https://example.org/full.pdf");

    expect(second.venue).toBeNull();
    expect(second.abstract).toBeNull();
    expect(second.pdfUrl).toBeNull();
  });

  it("sends year-range filters when yearFrom/yearTo are provided", async () => {
    let capturedUrl: URL | undefined;
    server.use(
      http.get("https://api.crossref.org/works", ({ request }) => {
        capturedUrl = new URL(request.url);
        return HttpResponse.json(fixture);
      }),
    );

    await crossrefAdapter.search({
      query: "x",
      yearFrom: 2018,
      yearTo: 2022,
      signal: new AbortController().signal,
    });

    expect(capturedUrl?.searchParams.get("filter")).toBe(
      "from-pub-date:2018-01-01,until-pub-date:2022-12-31",
    );
  });
});
