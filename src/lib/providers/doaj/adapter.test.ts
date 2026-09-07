import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw-server";
import { doajAdapter } from "@/lib/providers/doaj/adapter";
import fixture from "@/test/fixtures/doaj-search.json";

describe("doajAdapter", () => {
  it("is always configured (no credentials required)", () => {
    expect(doajAdapter.isConfigured()).toBe(true);
    expect(doajAdapter.meta.requiresCredential).toBe(false);
  });

  it("maps DOAJ articles into the common RawWork shape", async () => {
    server.use(
      http.get("https://doaj.org/api/search/articles/:query", () => HttpResponse.json(fixture)),
    );

    const result = await doajAdapter.search({
      query: "open access",
      signal: new AbortController().signal,
    });

    expect(result.totalCount).toBe(2);
    expect(result.works).toHaveLength(2);

    const [first, second] = result.works;
    expect(first.sourceId).toBe("doaj");
    expect(first.doi).toBe("10.5555/joss.2022.001");
    expect(first.title).toBe("Open Access Practices in Developing Countries");
    expect(first.authors).toEqual([{ name: "Maria Santos" }, { name: "Wei Zhang" }]);
    expect(first.year).toBe(2022);
    expect(first.venue).toBe("Journal of Open Science");
    expect(first.isOpenAccess).toBe(true);
    expect(first.pdfUrl).toBe("https://example.org/joss/2022/001.pdf");

    // Every DOAJ-listed article is open access by definition, even without a
    // fulltext link or DOI on the record.
    expect(second.isOpenAccess).toBe(true);
    expect(second.doi).toBeNull();
    expect(second.landingPageUrl).toContain("xyz789");
  });

  it("URL-encodes the query as a path segment", async () => {
    let capturedPath = "";
    server.use(
      http.get("https://doaj.org/api/search/articles/:query", ({ params }) => {
        capturedPath = params.query as string;
        return HttpResponse.json(fixture);
      }),
    );

    await doajAdapter.search({ query: "gene therapy", signal: new AbortController().signal });
    expect(capturedPath).toBe("gene therapy");
  });
});
