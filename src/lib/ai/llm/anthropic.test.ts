import { describe, it, expect, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw-server";
import { anthropicLlmProvider } from "@/lib/ai/llm/anthropic";

const ORIGINAL_KEY = process.env.ANTHROPIC_API_KEY;

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = ORIGINAL_KEY;
});

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

describe("anthropicLlmProvider", () => {
  it("is not configured without ANTHROPIC_API_KEY", () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(anthropicLlmProvider.isConfigured()).toBe(false);
  });

  it("is configured when ANTHROPIC_API_KEY is set", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    expect(anthropicLlmProvider.isConfigured()).toBe(true);
  });

  describe("complete", () => {
    it("throws a clear error when called without a configured API key", async () => {
      delete process.env.ANTHROPIC_API_KEY;
      await expect(
        anthropicLlmProvider.complete({
          model: "claude-haiku-4-5-20251001",
          messages: [{ role: "user", content: "hi" }],
        }),
      ).rejects.toThrow(/ANTHROPIC_API_KEY/);
    });

    it("returns the text content of a successful response", async () => {
      process.env.ANTHROPIC_API_KEY = "sk-ant-test";
      let capturedBody: Record<string, unknown> | undefined;

      server.use(
        http.post("https://api.anthropic.com/v1/messages", async ({ request }) => {
          capturedBody = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({
            id: "msg_test",
            type: "message",
            role: "assistant",
            model: "claude-haiku-4-5-20251001",
            content: [{ type: "text", text: "This is a plain-language summary." }],
            stop_reason: "end_turn",
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 8 },
          });
        }),
      );

      const result = await anthropicLlmProvider.complete({
        model: "claude-haiku-4-5-20251001",
        system: "Summarize plainly.",
        messages: [{ role: "user", content: "Summarize this abstract." }],
      });

      expect(result).toBe("This is a plain-language summary.");
      expect(capturedBody).toMatchObject({
        model: "claude-haiku-4-5-20251001",
        system: "Summarize plainly.",
        messages: [{ role: "user", content: "Summarize this abstract." }],
      });
    });

    it("throws on an API error response", async () => {
      process.env.ANTHROPIC_API_KEY = "sk-ant-test";
      server.use(
        http.post("https://api.anthropic.com/v1/messages", () =>
          HttpResponse.json(
            { type: "error", error: { type: "authentication_error", message: "invalid key" } },
            { status: 401 },
          ),
        ),
      );

      await expect(
        anthropicLlmProvider.complete({
          model: "claude-haiku-4-5-20251001",
          messages: [{ role: "user", content: "hi" }],
        }),
      ).rejects.toThrow();
    });
  });

  describe("streamComplete", () => {
    it("throws a clear error when called without a configured API key", async () => {
      delete process.env.ANTHROPIC_API_KEY;
      const generator = anthropicLlmProvider.streamComplete({
        model: "claude-sonnet-5",
        messages: [{ role: "user", content: "hi" }],
      });
      await expect(generator.next()).rejects.toThrow(/ANTHROPIC_API_KEY/);
    });

    it("yields incremental text deltas from a streamed response", async () => {
      process.env.ANTHROPIC_API_KEY = "sk-ant-test";

      server.use(
        http.post("https://api.anthropic.com/v1/messages", () => {
          const body =
            sseEvent("message_start", {
              type: "message_start",
              message: {
                id: "msg_test",
                type: "message",
                role: "assistant",
                content: [],
                model: "claude-sonnet-5",
                stop_reason: null,
                stop_sequence: null,
                usage: { input_tokens: 10, output_tokens: 0 },
              },
            }) +
            sseEvent("content_block_start", {
              type: "content_block_start",
              index: 0,
              content_block: { type: "text", text: "" },
            }) +
            sseEvent("content_block_delta", {
              type: "content_block_delta",
              index: 0,
              delta: { type: "text_delta", text: "Hello" },
            }) +
            sseEvent("content_block_delta", {
              type: "content_block_delta",
              index: 0,
              delta: { type: "text_delta", text: " there" },
            }) +
            sseEvent("content_block_stop", { type: "content_block_stop", index: 0 }) +
            sseEvent("message_delta", {
              type: "message_delta",
              delta: { stop_reason: "end_turn", stop_sequence: null },
              usage: { output_tokens: 2 },
            }) +
            sseEvent("message_stop", { type: "message_stop" });

          return new HttpResponse(body, { headers: { "Content-Type": "text/event-stream" } });
        }),
      );

      const chunks: string[] = [];
      for await (const chunk of anthropicLlmProvider.streamComplete({
        model: "claude-sonnet-5",
        messages: [{ role: "user", content: "Say hello" }],
      })) {
        chunks.push(chunk);
      }

      expect(chunks.join("")).toBe("Hello there");
    });
  });
});
