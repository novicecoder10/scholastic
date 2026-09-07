import { describe, it, expect, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw-server";
import { openaiEmbeddingProvider } from "@/lib/ai/embeddings/openai";

const ORIGINAL_KEY = process.env.OPENAI_API_KEY;

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = ORIGINAL_KEY;
});

describe("openaiEmbeddingProvider", () => {
  it("is not configured without OPENAI_API_KEY", () => {
    delete process.env.OPENAI_API_KEY;
    expect(openaiEmbeddingProvider.isConfigured()).toBe(false);
  });

  it("is configured when OPENAI_API_KEY is set", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    expect(openaiEmbeddingProvider.isConfigured()).toBe(true);
  });

  it("has a modelId identifying the hosted backend and target dimensions", () => {
    expect(openaiEmbeddingProvider.modelId).toBe("openai:text-embedding-3-small:384");
  });

  it("returns an empty array for an empty input without making a request", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    server.use(
      http.post("https://api.openai.com/v1/embeddings", () => {
        throw new Error("should not be called for empty input");
      }),
    );
    const result = await openaiEmbeddingProvider.embed([]);
    expect(result).toEqual([]);
  });

  it("throws when called without a configured API key", async () => {
    delete process.env.OPENAI_API_KEY;
    await expect(openaiEmbeddingProvider.embed(["hello"])).rejects.toThrow(/OPENAI_API_KEY/);
  });

  it("requests the configured dimensions and returns vectors in input order, even if the API responds out of order", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    let capturedBody: Record<string, unknown> | undefined;

    server.use(
      http.post("https://api.openai.com/v1/embeddings", async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          data: [
            { embedding: [0.2, 0.2], index: 1 },
            { embedding: [0.1, 0.1], index: 0 },
          ],
        });
      }),
    );

    const result = await openaiEmbeddingProvider.embed(["first text", "second text"]);

    expect(result).toEqual([
      [0.1, 0.1],
      [0.2, 0.2],
    ]);
    expect(capturedBody).toMatchObject({
      model: "text-embedding-3-small",
      input: ["first text", "second text"],
      dimensions: 384,
    });
  });

  it("throws a clear error on a non-OK response", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    server.use(
      http.post("https://api.openai.com/v1/embeddings", () =>
        HttpResponse.json({ error: "bad key" }, { status: 401 }),
      ),
    );
    await expect(openaiEmbeddingProvider.embed(["hello"])).rejects.toThrow(/401/);
  });
});
