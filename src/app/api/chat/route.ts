import { NextRequest, NextResponse } from "next/server";
import { NO_LLM_PROVIDER_MESSAGE } from "@/lib/ai/llm";
import { meteredLlm } from "@/lib/credits/metered";
import { insufficientCreditsResponse, isInsufficientCredits } from "@/lib/credits/apiResponse";
import type { ChatMessage } from "@/lib/ai/llm/types";
import { buildSynthesisContext, type SynthesisWork } from "@/lib/ai/synthesisContext";
import { buildDocumentContext } from "@/lib/documents/chatContext";
import { findOwned } from "@/lib/documents/repository";
import { retrieveChunks } from "@/lib/documents/retrieve";
import { readOwner } from "@/lib/auth/owner";
import { logger } from "@/lib/log/logger";

export const runtime = "nodejs";

const SYSTEM_PROMPT =
  "You are a research assistant helping a user understand an academic paper (or set of papers) " +
  "surfaced by Scholastic's search. Answer questions grounded in the context provided below. If " +
  "something isn't covered by that context, say so plainly rather than guessing or fabricating " +
  "details. Be concise.";

const AGREEMENT_SYSTEM_PROMPT =
  "You are a research assistant comparing multiple academic papers surfaced by Scholastic's " +
  "search. Given the papers in the context below, identify where they agree and where their " +
  "claims, methods, or findings conflict. Respond in markdown with two sections: '## Agreements' " +
  "and '## Contradictions', referring to papers by their title (not by number or index). If " +
  "there isn't enough information in the context to identify agreements or contradictions, say " +
  "so plainly rather than guessing. Be concise.";

const LITERATURE_REVIEW_SYSTEM_PROMPT =
  "You are a research assistant drafting a structured literature review from multiple academic " +
  "papers surfaced by Scholastic's search. Given the papers in the context below, write a draft " +
  "with these markdown sections: '## Introduction', '## Themes', '## Gaps', and '## References' " +
  "(a list of the papers actually used, by title). Refer to papers by their title (not by number " +
  "or index) throughout. Ground every claim in the provided context — if the context is too thin " +
  "to support a section, say so plainly rather than fabricating content. Be concise.";

const DOCUMENT_SYSTEM_PROMPT =
  "You are a research assistant answering questions about one academic paper the user has " +
  "uploaded. The context below contains excerpts retrieved from that paper, each preceded by the " +
  "page it came from, e.g. '[page 7]'. Answer only from those excerpts. Cite the page for every " +
  "specific claim, in the form '[p. 7]', placed immediately after the claim it supports. " +
  "Crucially, distinguish two different situations and never conflate them: if the excerpts do " +
  "not address the question, say the retrieved excerpts don't cover it and suggest how the user " +
  "might rephrase — do NOT say the paper doesn't discuss it, because you are seeing only part of " +
  "the paper. Only say the paper itself lacks something when an excerpt explicitly says so. " +
  "Never invent a page number. Be concise.";

type ChatMode = "qa" | "agreement" | "literature-review";

function systemPromptForMode(mode: ChatMode | undefined): string {
  switch (mode) {
    case "agreement":
      return AGREEMENT_SYSTEM_PROMPT;
    case "literature-review":
      return LITERATURE_REVIEW_SYSTEM_PROMPT;
    default:
      return SYSTEM_PROMPT;
  }
}

interface ChatRequestBody {
  messages: ChatMessage[];
  /** Single-paper context (title/abstract, etc) — mutually exclusive with `works`. */
  context?: string;
  /**
   * Multi-paper synthesis: the current result set, client-supplied (the
   * client already has this data from the search response — see
   * synthesisContext.ts for why this isn't a server-side `work`-table
   * lookup). Ranked by similarity to `rankingQuery` (falling back to
   * `messages[0].content`) server-side before the first LLM call.
   */
  works?: SynthesisWork[];
  /**
   * Full-text chat over a PDF the caller uploaded (sub-project #3). Mutually
   * exclusive with `context` and `works`. Ownership is re-checked here against
   * the signed session cookie — holding the id is not enough.
   */
  documentId?: string;
  /**
   * Which system prompt/output shape to use — plain Q&A (default),
   * agreement/contradiction detection, or a literature-review draft. All
   * three reuse the same ranked-context + streaming machinery below; only
   * the system prompt and the ranking-query source differ.
   */
  mode?: ChatMode;
  /**
   * The topical query to rank `works` against. For plain Q&A this defaults to
   * `messages[0].content` (the user's literal question), which is right —
   * but the agreement/literature-review modes' opening message is a fixed
   * instruction, not a topical query, so those callers should supply the
   * original search query here instead.
   */
  rankingQuery?: string;
}

function isValidMessages(value: unknown): value is ChatMessage[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (m) =>
        typeof m === "object" &&
        m !== null &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string",
    )
  );
}

function isValidWorks(value: unknown): value is SynthesisWork[] {
  if (value === undefined) return true;
  return (
    Array.isArray(value) &&
    value.every(
      (w) =>
        typeof w === "object" &&
        w !== null &&
        typeof w.workKey === "string" &&
        typeof w.title === "string" &&
        (w.abstract === null || typeof w.abstract === "string"),
    )
  );
}

function isValidMode(value: unknown): value is ChatMode | undefined {
  return (
    value === undefined || value === "qa" || value === "agreement" || value === "literature-review"
  );
}

/** Naive fallback if similarity-ranking itself fails (rare — e.g. the
 * embedding backend is entirely down): unranked, first-N context is still
 * better than failing the whole chat request. */
function naiveContext(works: SynthesisWork[]): string {
  return works
    .slice(0, 8)
    .map(
      (w, i) =>
        `Paper ${i + 1}: ${w.title}\n${w.abstract ? `Abstract: ${w.abstract}` : "(no abstract available)"}`,
    )
    .join("\n\n");
}

/**
 * Streams plain text chunks (not full SSE framing — this is our own backend
 * consumed by our own frontend via a plain ReadableStream reader, so SSE's
 * event-typing/reconnection semantics would be unused complexity). No
 * persistence: chat history is round-tripped in full by the client on every
 * turn (accounts/saved state are explicitly out of scope — see ROADMAP.md).
 */
export async function POST(request: NextRequest) {
  let body: ChatRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isValidMessages(body.messages)) {
    return NextResponse.json(
      { error: "'messages' must be a non-empty array of {role, content}" },
      { status: 400 },
    );
  }
  if (!isValidWorks(body.works)) {
    return NextResponse.json(
      { error: "'works' must be an array of {workKey, title, abstract}" },
      { status: 400 },
    );
  }
  if (!isValidMode(body.mode)) {
    return NextResponse.json(
      { error: "'mode' must be one of 'qa', 'agreement', 'literature-review'" },
      { status: 400 },
    );
  }
  if (body.rankingQuery !== undefined && typeof body.rankingQuery !== "string") {
    return NextResponse.json({ error: "'rankingQuery' must be a string" }, { status: 400 });
  }
  if (body.documentId !== undefined && typeof body.documentId !== "string") {
    return NextResponse.json({ error: "'documentId' must be a string" }, { status: 400 });
  }

  // Previously `works` won over `context` implicitly, by ordering. With a third
  // context source that implicit precedence becomes genuinely ambiguous, so the
  // conflict is now named rather than silently resolved.
  const sources = (["context", "works", "documentId"] as const).filter(
    (key) => body[key] !== undefined,
  );
  if (sources.length > 1) {
    return NextResponse.json(
      { error: `Only one context source may be supplied; got ${sources.join(" and ")}` },
      { status: 400 },
    );
  }

  let context = body.context;
  let documentPrompt = false;

  if (body.documentId) {
    const owner = await readOwner();
    // Unowned and nonexistent are the same answer on purpose — see
    // lib/documents/repository.ts findOwned().
    const notFound = NextResponse.json({ error: "Document not found" }, { status: 404 });
    if (!owner) return notFound;

    let record;
    try {
      record = await findOwned(owner, body.documentId);
    } catch (err) {
      logger.error(
        { event: "document_chat_lookup_failed", err: String(err) },
        "document lookup failed",
      );
      return NextResponse.json({ error: "Couldn't load that document." }, { status: 503 });
    }
    if (!record) return notFound;

    // Deliberately the LATEST message, not messages[0] as the `works` branch
    // below uses. That branch's reasoning ("the topic is fixed, so every turn
    // recomputes an identical top-8") does not transfer to a single document:
    // "what dataset did they use?" and "what do the limitations concede?" are
    // questions about different pages of the same paper, so ranking a
    // follow-up against the opening question would retrieve the wrong pages.
    const latest = body.messages[body.messages.length - 1].content;
    try {
      context = buildDocumentContext(await retrieveChunks(body.documentId, latest));
    } catch (err) {
      logger.warn(
        { event: "document_retrieval_failed", err: String(err) },
        "document retrieval failed; answering without excerpts",
      );
      context = "";
    }
    // An empty string would fall through to a context-free system prompt,
    // which is exactly the state the prompt must not silently paper over.
    if (context.trim() === "") context = "(no excerpts matched this question)";
    documentPrompt = true;
  }
  if (body.works && body.works.length > 0) {
    // Always derive ranking from the original question (messages[0]) or the
    // caller-supplied rankingQuery, not the latest message — deterministic
    // given the pure similarity math + cache, so every turn recomputes the
    // identical top-8 with no extra LLM cost and no selection state to
    // persist across turns.
    const rankingQuery = body.rankingQuery ?? body.messages[0].content;
    try {
      context = await buildSynthesisContext(rankingQuery, body.works);
    } catch (err) {
      logger.warn(
        { event: "synthesis_context_failed", err: String(err) },
        "synthesis context ranking failed, using naive fallback",
      );
      context = naiveContext(body.works);
    }
  }

  // Acquired here rather than at the top of the handler so the feature name —
  // and therefore the estimate the caller is checked against — reflects which
  // of the three chats this actually is. A synthesis turn across eight papers
  // is not the same size of request as a question about one abstract.
  const feature = documentPrompt
    ? "document_chat_turn"
    : body.works && body.works.length > 0
      ? "synthesis_turn"
      : "chat_turn";

  let metered;
  try {
    metered = await meteredLlm(feature, "quality");
  } catch (err) {
    if (isInsufficientCredits(err)) return insufficientCreditsResponse(err);
    throw err;
  }
  if (!metered) {
    return NextResponse.json(
      { error: `Chat is not configured on this instance — ${NO_LLM_PROVIDER_MESSAGE}` },
      { status: 503 },
    );
  }
  const provider = metered.provider;

  const systemPrompt = documentPrompt ? DOCUMENT_SYSTEM_PROMPT : systemPromptForMode(body.mode);
  const system = context ? `${systemPrompt}\n\nContext:\n${context}` : systemPrompt;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of provider.streamComplete({
          model: provider.models.capable,
          system,
          messages: body.messages,
          onUsage: metered.onUsage,
        })) {
          controller.enqueue(encoder.encode(chunk));
        }
      } catch (err) {
        logger.error({ event: "chat_stream_failed", err: String(err) }, "chat stream failed");
        controller.enqueue(encoder.encode("\n\n[The response was interrupted by an error.]"));
      } finally {
        controller.close();
      }
    },
  });

  return new NextResponse(stream, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
