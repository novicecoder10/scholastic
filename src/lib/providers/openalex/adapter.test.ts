import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw-server";
import { openAlexAdapter } from "@/lib/providers/openalex/adapter";
import fixture from "@/test/fixtures/openalex-search.json";

describe("openAlexAdapter", () => {
  it("is always configured (no credentials required)", () => {
    expect(openAlexAdapter.isConfigured()).toBe(true);
    expect(openAlexAdapter.meta.requiresCredential).toBe(false);
  });

  it("maps OpenAlex works into the common RawWork shape", async () => {
    server.use(http.get("https://api.openalex.org/works", () => HttpResponse.json(fixture)));

    const result = await openAlexAdapter.search({
      query: "transformers",
      signal: new AbortController().signal,
    });

    expect(result.totalCount).toBe(2);
    expect(result.works).toHaveLength(2);

    const [first, second] = result.works;
    expect(first.sourceId).toBe("openalex");
    expect(first.doi).toBe("10.48550/arxiv.1706.03762");
    expect(first.title).toBe("Attention Is All You Need");
    expect(first.abstract).toBe("The dominant sequence transduction models");
    expect(first.authors).toEqual([
      { name: "Ashish Vaswani", orcid: undefined },
      { name: "Noam Shazeer", orcid: "0000-0001-2345-6789" },
    ]);
    expect(first.year).toBe(2017);
    expect(first.venue).toBe("arXiv");
    expect(first.citationCount).toBe(120000);
    expect(first.isOpenAccess).toBe(true);
    expect(first.pdfUrl).toBe("https://arxiv.org/pdf/1706.03762");

    expect(second.doi).toBeNull();
    expect(second.abstract).toBeNull();
    expect(second.isOpenAccess).toBe(false);
  });

  it("appends the polite-pool mailto param only when OPENALEX_EMAIL is set", async () => {
    const originalEmail = process.env.OPENALEX_EMAIL;

    let capturedUrl: URL | undefined;
    server.use(
      http.get("https://api.openalex.org/works", ({ request }) => {
        capturedUrl = new URL(request.url);
        return HttpResponse.json(fixture);
      }),
    );

    delete process.env.OPENALEX_EMAIL;
    await openAlexAdapter.search({ query: "transformers", signal: new AbortController().signal });
    expect(capturedUrl?.searchParams.has("mailto")).toBe(false);

    process.env.OPENALEX_EMAIL = "test@example.com";
    await openAlexAdapter.search({ query: "transformers", signal: new AbortController().signal });
    expect(capturedUrl?.searchParams.get("mailto")).toBe("test@example.com");

    process.env.OPENALEX_EMAIL = originalEmail;
  });
});
