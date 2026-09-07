import { describe, it, expect, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw-server";
import { createOpenAiCompatibleProvider } from "@/lib/ai/llm/openAiCompatible";

const TEST_BASE_URL = "https://example-llm.test/v1/chat/completions";
const TEST_API_KEY_ENV_VAR = "TEST_OPENAI_COMPAT_API_KEY";

const provider = createOpenAiCompatibleProvider({
  providerId: "test_llm",
  displayName: "Test Provider",
  baseUrl: TEST_BASE_URL,
  apiKeyEnvVar: TEST_API_KEY_ENV_VAR,
  cheapModelEnvVar: "TEST_MODEL_CHEAP",
  capableModelEnvVar: "TEST_MODEL_CAPABLE",
  defaultCheapModel: "cheap-default",
  defaultCapableModel: "capable-default",
});

afterEach(() => {
  delete process.env[TEST_API_KEY_ENV_VAR];
});

function sseBody(deltas: string[]): string {
  return (
    deltas
      .map((text) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`)
      .join("") + "data: [DONE]\n\n"
  );
}

describe("createOpenAiCompatibleProvider", () => {
  it("uses the configured default models when no env override is set", () => {
    expect(provider.models).toEqual({ cheap: "cheap-default", capable: "capable-default" });
  });

  it("is not configured without the API key env var set", () => {
    delete process.env[TEST_API_KEY_ENV_VAR];
    expect(provider.isConfigured()).toBe(false);
  });

  it("is configured once the API key env var is set", () => {
    process.env[TEST_API_KEY_ENV_VAR] = "test-key";
    expect(provider.isConfigured()).toBe(true);
  });

  describe("complete", () => {
    it("throws a clear error without a configured key", async () => {
      delete process.env[TEST_API_KEY_ENV_VAR];
      await expect(
        provider.complete({ model: "test-model", messages: [{ role: "user", content: "hi" }] }),
      ).rejects.toThrow(new RegExp(TEST_API_KEY_ENV_VAR));
    });

    it("returns the completion's message content, prepending system as a message", async () => {
      process.env[TEST_API_KEY_ENV_VAR] = "test-key";
      let capturedBody: Record<string, unknown> | undefined;

      server.use(
        http.post(TEST_BASE_URL, async ({ request }) => {
          capturedBody = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({ choices: [{ message: { content: "A response." } }] });
        }),
      );

      const result = await provider.complete({
        model: "test-model",
        system: "Be concise.",
        messages: [{ role: "user", content: "Summarize this." }],
      });

      expect(result).toBe("A response.");
      expect(capturedBody).toMatchObject({
        model: "test-model",
        messages: [
          { role: "system", content: "Be concise." },
          { role: "user", content: "Summarize this." },
        ],
      });
    });

    it("throws on a non-OK response", async () => {
      process.env[TEST_API_KEY_ENV_VAR] = "test-key";
      server.use(
        http.post(TEST_BASE_URL, () => HttpResponse.json({ error: "bad key" }, { status: 401 })),
      );
      await expect(
        provider.complete({ model: "test-model", messages: [{ role: "user", content: "hi" }] }),
      ).rejects.toThrow(/401/);
    });
  });

  describe("streamComplete", () => {
    it("yields incremental deltas parsed from OpenAI-style SSE frames", async () => {
      process.env[TEST_API_KEY_ENV_VAR] = "test-key";
      server.use(
        http.post(TEST_BASE_URL, () => {
          const body = sseBody(["Hello", " there", "!"]);
          return new HttpResponse(body, { headers: { "Content-Type": "text/event-stream" } });
        }),
      );

      const chunks: string[] = [];
      for await (const chunk of provider.streamComplete({
        model: "test-model",
        messages: [{ role: "user", content: "Say hello" }],
      })) {
        chunks.push(chunk);
      }

      expect(chunks.join("")).toBe("Hello there!");
    });

    it("ignores malformed/partial SSE lines rather than aborting the stream", async () => {
      process.env[TEST_API_KEY_ENV_VAR] = "test-key";
      server.use(
        http.post(TEST_BASE_URL, () => {
          const body =
            "data: not valid json\n\n" +
            `data: ${JSON.stringify({ choices: [{ delta: { content: "ok" } }] })}\n\n` +
            "data: [DONE]\n\n";
          return new HttpResponse(body, { headers: { "Content-Type": "text/event-stream" } });
        }),
      );

      const chunks: string[] = [];
      for await (const chunk of provider.streamComplete({
        model: "test-model",
        messages: [{ role: "user", content: "hi" }],
      })) {
        chunks.push(chunk);
      }
      expect(chunks.join("")).toBe("ok");
    });
  });
});
