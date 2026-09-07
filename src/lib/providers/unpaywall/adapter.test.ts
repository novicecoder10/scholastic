import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw-server";
import { unpaywallAdapter } from "@/lib/providers/unpaywall/adapter";
import fixture from "@/test/fixtures/unpaywall-search.json";

describe("unpaywallAdapter", () => {
  it("is not configured without UNPAYWALL_EMAIL, and is configured once it's set", () => {
    const original = process.env.UNPAYWALL_EMAIL;

    delete process.env.UNPAYWALL_EMAIL;
    expect(unpaywallAdapter.isConfigured()).toBe(false);
    expect(unpaywallAdapter.meta.isEnabled).toBe(false);

    process.env.UNPAYWALL_EMAIL = "test@example.com";
    expect(unpaywallAdapter.isConfigured()).toBe(true);
    expect(unpaywallAdapter.meta.isEnabled).toBe(true);

    process.env.UNPAYWALL_EMAIL = original;
  });

  it("maps Unpaywall results into the common RawWork shape, sending the required email param", async () => {
    const original = process.env.UNPAYWALL_EMAIL;
    process.env.UNPAYWALL_EMAIL = "test@example.com";

    let capturedUrl: URL | undefined;
    server.use(
      http.get("https://api.unpaywall.org/v2/search", ({ request }) => {
        capturedUrl = new URL(request.url);
        return HttpResponse.json(fixture);
      }),
    );

    const result = await unpaywallAdapter.search({
      query: "crispr",
      signal: new AbortController().signal,
    });

    expect(capturedUrl?.searchParams.get("email")).toBe("test@example.com");
    expect(result.totalCount).toBe(2);
    expect(result.works).toHaveLength(2);

    const [first, second] = result.works;
    expect(first.sourceId).toBe("unpaywall");
    expect(first.doi).toBe("10.1038/s41586-020-1234-5");
    expect(first.authors).toEqual([{ name: "J Smith" }, { name: "A Doe" }]);
    expect(first.isOpenAccess).toBe(true);
    expect(first.pdfUrl).toBe("https://europepmc.org/articles/PMC1234/pdf");

    expect(second.isOpenAccess).toBe(false);
    expect(second.pdfUrl).toBeNull();

    process.env.UNPAYWALL_EMAIL = original;
  });
});
