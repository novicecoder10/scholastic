import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw-server";
import { europePmcAdapter } from "@/lib/providers/europepmc/adapter";
import fixture from "@/test/fixtures/europepmc-search.json";

describe("europePmcAdapter", () => {
  it("is always configured (no credentials required)", () => {
    expect(europePmcAdapter.isConfigured()).toBe(true);
    expect(europePmcAdapter.meta.requiresCredential).toBe(false);
  });

  it("maps Europe PMC results into the common RawWork shape", async () => {
    server.use(
      http.get("https://www.ebi.ac.uk/europepmc/webservices/rest/search", () =>
        HttpResponse.json(fixture),
      ),
    );

    const result = await europePmcAdapter.search({
      query: "crispr",
      signal: new AbortController().signal,
    });

    expect(result.totalCount).toBe(2);
    expect(result.works).toHaveLength(2);

    const [first, second] = result.works;
    expect(first.sourceId).toBe("europepmc");
    expect(first.doi).toBe("10.1038/s41586-020-1234-5");
    expect(first.title).toBe("CRISPR-based gene editing in human cells");
    expect(first.authors).toEqual([{ name: "Smith J" }, { name: "Doe A" }, { name: "Lee K." }]);
    expect(first.year).toBe(2020);
    expect(first.venue).toBe("Nature");
    expect(first.citationCount).toBe(890);
    expect(first.isOpenAccess).toBe(true);
    expect(first.pdfUrl).toBe("https://europepmc.org/articles/PMC1234/pdf");

    expect(second.isOpenAccess).toBe(false);
    expect(second.doi).toBeNull();
    expect(second.pdfUrl).toBeNull();
    expect(second.landingPageUrl).toContain("11112222");
  });

  it("requests resultType=core so abstracts are included", async () => {
    let capturedUrl: URL | undefined;
    server.use(
      http.get("https://www.ebi.ac.uk/europepmc/webservices/rest/search", ({ request }) => {
        capturedUrl = new URL(request.url);
        return HttpResponse.json(fixture);
      }),
    );

    await europePmcAdapter.search({ query: "x", signal: new AbortController().signal });
    expect(capturedUrl?.searchParams.get("resultType")).toBe("core");
  });
});
