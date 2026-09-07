import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw-server";
import { coreAdapter } from "@/lib/providers/core/adapter";
import fixture from "@/test/fixtures/core-search.json";

describe("coreAdapter", () => {
  it("is not configured without CORE_API_KEY, and is configured once it's set", () => {
    const original = process.env.CORE_API_KEY;

    delete process.env.CORE_API_KEY;
    expect(coreAdapter.isConfigured()).toBe(false);
    expect(coreAdapter.meta.isEnabled).toBe(false);

    process.env.CORE_API_KEY = "test-key";
    expect(coreAdapter.isConfigured()).toBe(true);
    expect(coreAdapter.meta.isEnabled).toBe(true);

    process.env.CORE_API_KEY = original;
  });

  it("requires credentials per its metadata", () => {
    expect(coreAdapter.meta.requiresCredential).toBe(true);
  });

  it("maps CORE works into the common RawWork shape, sending the bearer token", async () => {
    const original = process.env.CORE_API_KEY;
    process.env.CORE_API_KEY = "test-key";

    let capturedAuth: string | null = null;
    server.use(
      http.get("https://api.core.ac.uk/v3/search/works", ({ request }) => {
        capturedAuth = request.headers.get("Authorization");
        return HttpResponse.json(fixture);
      }),
    );

    const result = await coreAdapter.search({
      query: "open data",
      signal: new AbortController().signal,
    });

    expect(capturedAuth).toBe("Bearer test-key");
    expect(result.totalCount).toBe(2);
    expect(result.works).toHaveLength(2);

    const [first, second] = result.works;
    expect(first.sourceId).toBe("core");
    expect(first.doi).toBe("10.5281/zenodo.999999");
    expect(first.isOpenAccess).toBe(true);
    expect(first.pdfUrl).toBe("https://core.ac.uk/download/12345.pdf");
    expect(first.venue).toBe("Example Repository Journal");

    expect(second.doi).toBeNull();
    expect(second.venue).toBe("Another Press");

    process.env.CORE_API_KEY = original;
  });
});
