import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { readFileSync } from "node:fs";
import path from "node:path";
import { server } from "@/test/msw-server";
import { pubmedAdapter } from "@/lib/providers/pubmed/adapter";
import esearchFixture from "@/test/fixtures/pubmed-esearch.json";
import esummaryFixture from "@/test/fixtures/pubmed-esummary.json";

const efetchXml = readFileSync(
  path.join(process.cwd(), "src/test/fixtures/pubmed-efetch.xml"),
  "utf-8",
);

function registerHandlers() {
  server.use(
    http.get("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi", () =>
      HttpResponse.json(esearchFixture),
    ),
    http.get("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi", () =>
      HttpResponse.json(esummaryFixture),
    ),
    http.get("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi", () => {
      return new HttpResponse(efetchXml, { headers: { "Content-Type": "application/xml" } });
    }),
  );
}

describe("pubmedAdapter", () => {
  it("is not configured without NCBI_EMAIL, and is configured once it's set", () => {
    const original = process.env.NCBI_EMAIL;

    delete process.env.NCBI_EMAIL;
    expect(pubmedAdapter.isConfigured()).toBe(false);
    expect(pubmedAdapter.meta.isEnabled).toBe(false);

    process.env.NCBI_EMAIL = "test@example.com";
    expect(pubmedAdapter.isConfigured()).toBe(true);
    expect(pubmedAdapter.meta.isEnabled).toBe(true);

    process.env.NCBI_EMAIL = original;
  });

  it("requires credentials per its metadata", () => {
    expect(pubmedAdapter.meta.requiresCredential).toBe(true);
  });

  it("combines ESearch + ESummary + EFetch into the common RawWork shape", async () => {
    const original = process.env.NCBI_EMAIL;
    process.env.NCBI_EMAIL = "test@example.com";
    registerHandlers();

    const result = await pubmedAdapter.search({
      query: "crispr",
      signal: new AbortController().signal,
    });

    expect(result.totalCount).toBe(2);
    expect(result.works).toHaveLength(2);

    const [first, second] = result.works;
    expect(first.sourceId).toBe("pubmed");
    expect(first.sourceRecordId).toBe("34567890");
    expect(first.doi).toBe("10.1038/s41586-020-1234-5");
    expect(first.title).toBe("CRISPR-based gene editing in human cells.");
    expect(first.abstract).toBe(
      "CRISPR enables precise editing. We demonstrate efficient editing in cell lines.",
    );
    expect(first.authors).toEqual([{ name: "Smith JA" }, { name: "Doe B" }]);
    expect(first.year).toBe(2020);
    expect(first.venue).toBe("Nature");
    expect(first.landingPageUrl).toBe("https://pubmed.ncbi.nlm.nih.gov/34567890/");

    expect(second.doi).toBeNull();
    expect(second.abstract).toBe("A single unlabeled abstract paragraph.");
    expect(second.year).toBe(2018);

    process.env.NCBI_EMAIL = original;
  });

  it("returns an empty result set without calling ESummary/EFetch when ESearch finds nothing", async () => {
    process.env.NCBI_EMAIL = "test@example.com";
    let esummaryCalled = false;
    server.use(
      http.get("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi", () =>
        HttpResponse.json({ esearchresult: { count: "0", idlist: [] } }),
      ),
      http.get("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi", () => {
        esummaryCalled = true;
        return HttpResponse.json(esummaryFixture);
      }),
    );

    const result = await pubmedAdapter.search({
      query: "zzzznoresults",
      signal: new AbortController().signal,
    });

    expect(result.works).toEqual([]);
    expect(result.totalCount).toBe(0);
    expect(esummaryCalled).toBe(false);
  });
});
