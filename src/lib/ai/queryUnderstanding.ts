import { meteredLlm } from "@/lib/credits/metered";
import { logger } from "@/lib/log/logger";

const SYSTEM_PROMPT = `You turn a user's natural-language research question into a search request for an academic search engine, or ask one clarifying question if the input is too vague to search on.

Respond with ONLY a single JSON object, no other text, matching exactly one of these two shapes:
{"action":"search","query":"<a good literal search query string>","mode":"keyword"|"semantic"}
{"action":"clarify","question":"<one short clarifying question>"}

Guidance:
- Use "search" whenever the input names a topic, question, method, author, or field clearly enough to search on — most inputs should end up here.
- Use "semantic" mode for conceptual/natural-language questions ("papers that challenge X", "work exploring the connection between A and B"). Use "keyword" mode for direct topic/name/method searches.
- Only use "clarify" when the input is genuinely too vague to search on at all (e.g. a single ambiguous word, or an incomplete thought) — do not ask for unnecessary detail.
- Never wrap the JSON in markdown code fences or add commentary before or after it.`;

export interface QueryUnderstandingTurn {
  question: string;
  answer: string;
}

export type QueryUnderstandingResult =
  | { action: "search"; query: string; mode: "keyword" | "semantic" }
  | { action: "clarify"; question: string };

function parseResult(raw: string): QueryUnderstandingResult | null {
  // Strip common LLM output wrapping (markdown code fences) defensively
  // before parsing, in case the model doesn't follow the "no fences" instruction.
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

  let data: unknown;
  try {
    data = JSON.parse(cleaned);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const obj = data as Record<string, unknown>;

  if (
    obj.action === "search" &&
    typeof obj.query === "string" &&
    obj.query.trim().length > 0 &&
    (obj.mode === "keyword" || obj.mode === "semantic")
  ) {
    return { action: "search", query: obj.query, mode: obj.mode };
  }
  if (
    obj.action === "clarify" &&
    typeof obj.question === "string" &&
    obj.question.trim().length > 0
  ) {
    return { action: "clarify", question: obj.question };
  }
  return null;
}

/**
 * Defensive by design: the LLM provider not being configured, the call
 * failing, or the output not parsing into a valid shape all fall through to
 * treating the raw input as a literal keyword search — this must never
 * become a hard failure in front of search, the same graceful-degradation
 * contract as every other AI feature in this codebase.
 */
export async function understandQuery(
  input: string,
  priorTurns: QueryUnderstandingTurn[] = [],
): Promise<QueryUnderstandingResult> {
  const fallback: QueryUnderstandingResult = { action: "search", query: input, mode: "keyword" };

  const metered = await meteredLlm("query_understanding", "bulk");
  if (!metered) return fallback;
  const provider = metered.provider;

  const conversation =
    priorTurns.length > 0
      ? `\n\nEarlier clarification in this conversation:\n${priorTurns
          .map((t) => `Q: ${t.question}\nA: ${t.answer}`)
          .join("\n")}`
      : "";

  try {
    const raw = await provider.complete({
      model: provider.models.cheap,
      onUsage: metered.onUsage,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: `${input}${conversation}` }],
      maxTokens: 200,
    });

    return parseResult(raw) ?? fallback;
  } catch (err) {
    logger.warn(
      { event: "query_understanding_failed", err: String(err) },
      "query understanding failed, falling back to literal query",
    );
    return fallback;
  }
}
