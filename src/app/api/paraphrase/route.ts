import { NextRequest, NextResponse } from "next/server";
import { NO_LLM_PROVIDER_MESSAGE } from "@/lib/ai/llm";
import { meteredLlm } from "@/lib/credits/metered";
import { insufficientCreditsResponse, isInsufficientCredits } from "@/lib/credits/apiResponse";
import {
  buildParaphrasePrompt,
  countWords,
  isValidParaphraseMode,
  MAX_PARAPHRASE_WORDS,
  type ParaphraseMode,
} from "@/lib/ai/paraphrase";
import { logger } from "@/lib/log/logger";

interface ParaphraseRequestBody {
  text: string;
  mode: ParaphraseMode;
}

/**
 * Rewrites the user's OWN prose for clarity. Deliberately not a rewriter for
 * text lifted from a paper: the reader's counterpart action is "explain this
 * passage", which routes a selection into chat instead. Whose text it is
 * decides which verb applies, and the surfaces say which one they are.
 *
 * Streams plain text over the same `ReadableStream` machinery `/api/chat`
 * uses, for the same reason — our own backend, our own frontend, so SSE's
 * framing would be unused complexity.
 */
export async function POST(request: NextRequest) {
  let metered;
  try {
    metered = await meteredLlm("paraphrase", "quality");
  } catch (err) {
    if (isInsufficientCredits(err)) return insufficientCreditsResponse(err);
    throw err;
  }
  if (!metered) {
    return NextResponse.json(
      { error: `Rewriting is not configured on this instance — ${NO_LLM_PROVIDER_MESSAGE}` },
      { status: 503 },
    );
  }
  const provider = metered.provider;

  let body: ParaphraseRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.text !== "string" || body.text.trim() === "") {
    return NextResponse.json({ error: "'text' is required" }, { status: 400 });
  }
  if (!isValidParaphraseMode(body.mode)) {
    return NextResponse.json(
      { error: "'mode' must be one of 'plain-language', 'concise', 'formal'" },
      { status: 400 },
    );
  }

  const words = countWords(body.text);
  if (words > MAX_PARAPHRASE_WORDS) {
    return NextResponse.json(
      {
        error: `That's ${words} words; the limit is ${MAX_PARAPHRASE_WORDS}. Rewrite it in parts.`,
      },
      { status: 400 },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of provider.streamComplete({
          model: provider.models.capable,
          system: buildParaphrasePrompt(body.mode),
          messages: [{ role: "user", content: body.text }],
          onUsage: metered.onUsage,
        })) {
          controller.enqueue(encoder.encode(chunk));
        }
      } catch (err) {
        logger.error(
          { event: "paraphrase_stream_failed", err: String(err) },
          "paraphrase stream failed",
        );
        controller.enqueue(encoder.encode("\n\n[The rewrite was interrupted by an error.]"));
      } finally {
        controller.close();
      }
    },
  });

  return new NextResponse(stream, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
