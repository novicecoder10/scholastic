import { describe, it, expect, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw-server";
import {
  getOpenCitationsCitingWorks,
  getOpenCitationsReferences,
} from "@/lib/ai/citations/opencitations";

const ORIGINAL_TOKEN = process.env.OPENCITATIONS_ACCESS_TOKEN;

afterEach(() => {
  if (ORIGINAL_TOKEN === undefined) delete process.env.OPENCITATIONS_ACCESS_TOKEN;
  else process.env.OPENCITATIONS_ACCESS_TOKEN = ORIGINAL_TOKEN;
});

// The real code calls encodeURIComponent(doi) before building the URL, so a
// DOI's inherent "/" becomes "%2F" as a single path segment — handlers must
// match that encoded form, not a literal slash (which MSW would otherwise
// treat as two separate path segments).
describe("getOpenCitationsCitingWorks", () => {
  it("maps the 'citing' field of each item to a bare-DOI CitationRef", async () => {
    server.use(
      http.get("https://opencitations.net/index/coci/api/v1/citations/10.1%2Ftarget", () =>
        HttpResponse.json([
          { oci: "1-2", citing: "10.1/citer-a", cited: "10.1/target" },
          { oci: "3-4", citing: "10.1/citer-b", cited: "10.1/target" },
        ]),
      ),
    );

    const result = await getOpenCitationsCitingWorks("10.1/target");
    expect(result).toEqual([
      { doi: "10.1/citer-a", title: null, year: null },
      { doi: "10.1/citer-b", title: null, year: null },
    ]);
  });

  it("throws a clear error on a non-OK response", async () => {
    server.use(
      http.get("https://opencitations.net/index/coci/api/v1/citations/10.1%2Fmissing", () =>
        HttpResponse.json({ error: "not found" }, { status: 404 }),
      ),
    );
    await expect(getOpenCitationsCitingWorks("10.1/missing")).rejects.toThrow(/404/);
  });

  it("sends the access token as an authorization header when configured", async () => {
    process.env.OPENCITATIONS_ACCESS_TOKEN = "test-token";
    let capturedAuth: string | null = null;

    server.use(
      http.get(
        "https://opencitations.net/index/coci/api/v1/citations/10.1%2Ftarget",
        ({ request }) => {
          capturedAuth = request.headers.get("authorization");
          return HttpResponse.json([]);
        },
      ),
    );

    await getOpenCitationsCitingWorks("10.1/target");
    expect(capturedAuth).toBe("test-token");
  });
});

describe("getOpenCitationsReferences", () => {
  it("maps the 'cited' field of each item to a bare-DOI CitationRef", async () => {
    server.use(
      http.get("https://opencitations.net/index/coci/api/v1/references/10.1%2Fsource", () =>
        HttpResponse.json([{ oci: "1-2", citing: "10.1/source", cited: "10.1/referenced" }]),
      ),
    );

    const result = await getOpenCitationsReferences("10.1/source");
    expect(result).toEqual([{ doi: "10.1/referenced", title: null, year: null }]);
  });
});
