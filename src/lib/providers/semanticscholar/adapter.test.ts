import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw-server";
import { semanticScholarAdapter } from "@/lib/providers/semanticscholar/adapter";
import fixture from "@/test/fixtures/semanticscholar-search.json";

describe("semanticScholarAdapter", () => {
  it("is always configured — works unauthenticated, key only improves rate limits", () => {
    expect(semanticScholarAdapter.isConfigured()).toBe(true);
    expect(semanticScholarAdapter.meta.requiresCredential).toBe(false);
  });

  it("maps Semantic Scholar papers into the common RawWork shape", async () => {
    server.use(
      http.get("https://api.semanticscholar.org/graph/v1/paper/search", () =>
        HttpResponse.json(fixture),
      ),
    );

    const result = await semanticScholarAdapter.search({
      query: "transformers",
      signal: new AbortController().signal,
    });

    expect(result.totalCount).toBe(2);
    expect(result.works).toHaveLength(2);

    const [first, second] = result.works;
    expect(first.sourceId).toBe("semantic_scholar");
    expect(first.doi).toBe("10.48550/arXiv.1706.03762");
    expect(first.authors).toEqual([
      { name: "Ashish Vaswani", orcid: "0000-0001-2222-3333" },
      { name: "Noam Shazeer", orcid: undefined },
    ]);
    expect(first.isOpenAccess).toBe(true);
    expect(first.pdfUrl).toBe("https://arxiv.org/pdf/1706.03762");

    expect(second.isOpenAccess).toBe(false);
    expect(second.pdfUrl).toBeNull();
    expect(second.doi).toBeNull();
  });

  it("sends the x-api-key header only when SEMANTIC_SCHOLAR_API_KEY is set", async () => {
    const original = process.env.SEMANTIC_SCHOLAR_API_KEY;
    let capturedHeader: string | null = null;
    server.use(
      http.get("https://api.semanticscholar.org/graph/v1/paper/search", ({ request }) => {
        capturedHeader = request.headers.get("x-api-key");
        return HttpResponse.json(fixture);
      }),
    );

    delete process.env.SEMANTIC_SCHOLAR_API_KEY;
    await semanticScholarAdapter.search({ query: "x", signal: new AbortController().signal });
    expect(capturedHeader).toBeNull();

    process.env.SEMANTIC_SCHOLAR_API_KEY = "test-key";
    await semanticScholarAdapter.search({ query: "x", signal: new AbortController().signal });
    expect(capturedHeader).toBe("test-key");

    process.env.SEMANTIC_SCHOLAR_API_KEY = original;
  });
});
