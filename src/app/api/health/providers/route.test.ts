import { describe, it, expect } from "vitest";
import { GET } from "@/app/api/health/providers/route";

describe("GET /api/health/providers", () => {
  it("lists every registered provider with no secrets exposed", async () => {
    const response = await GET();
    const body = (await response.json()) as {
      providers: { id: string; requiresCredential: boolean; isEnabled: boolean; health: string }[];
    };

    const ids = body.providers.map((p) => p.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "openalex",
        "crossref",
        "arxiv",
        "europepmc",
        "doaj",
        "semantic_scholar",
        "core",
        "unpaywall",
        "pubmed",
      ]),
    );
    expect(ids).not.toContain("opencitations");

    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain(process.env.CORE_API_KEY ?? "__never_matches__");
    expect(bodyText).not.toMatch(/api[_-]?key/i);
  });

  it("reports keyed providers as disabled when their credentials are unset", async () => {
    const originalCore = process.env.CORE_API_KEY;
    const originalUnpaywall = process.env.UNPAYWALL_EMAIL;
    const originalNcbi = process.env.NCBI_EMAIL;
    delete process.env.CORE_API_KEY;
    delete process.env.UNPAYWALL_EMAIL;
    delete process.env.NCBI_EMAIL;

    const response = await GET();
    const body = (await response.json()) as {
      providers: { id: string; isEnabled: boolean; health: string }[];
    };

    for (const id of ["core", "unpaywall", "pubmed"]) {
      const provider = body.providers.find((p) => p.id === id)!;
      expect(provider.isEnabled).toBe(false);
      expect(provider.health).toBe("disabled");
    }

    process.env.CORE_API_KEY = originalCore;
    process.env.UNPAYWALL_EMAIL = originalUnpaywall;
    process.env.NCBI_EMAIL = originalNcbi;
  });

  it("reports a keyed provider as enabled once its credential is set", async () => {
    const original = process.env.CORE_API_KEY;
    process.env.CORE_API_KEY = "test-key";

    const response = await GET();
    const body = (await response.json()) as {
      providers: { id: string; isEnabled: boolean; health: string }[];
    };
    const core = body.providers.find((p) => p.id === "core")!;
    expect(core.isEnabled).toBe(true);
    expect(core.health).not.toBe("disabled");

    process.env.CORE_API_KEY = original;
  });

  it("always reports no-auth providers as enabled", async () => {
    const response = await GET();
    const body = (await response.json()) as { providers: { id: string; isEnabled: boolean }[] };
    for (const id of ["openalex", "crossref", "arxiv", "europepmc", "doaj"]) {
      expect(body.providers.find((p) => p.id === id)!.isEnabled).toBe(true);
    }
  });
});
