import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { work, workAiSummary } from "@/lib/db/schema";
import { NO_LLM_PROVIDER_MESSAGE } from "@/lib/ai/llm";
import { meteredLlm } from "@/lib/credits/metered";
import { WorkNotFoundError } from "@/lib/ai/errors";
import { logger } from "@/lib/log/logger";

const SUMMARY_SYSTEM_PROMPT =
  "You write single-paragraph, plain-language summaries of academic paper abstracts for a " +
  "general, non-expert audience. Explain what the paper is actually about and why it matters " +
  "in everyday language, without jargon. No preamble, no markdown formatting, no restating " +
  "the title — just the summary itself, 3-5 sentences.";

export class SummaryFeatureDisabledError extends Error {
  constructor() {
    super(`AI summaries are not configured on this instance — ${NO_LLM_PROVIDER_MESSAGE}`);
    this.name = "SummaryFeatureDisabledError";
  }
}

export interface SummaryResult {
  summary: string;
  cached: boolean;
}

export { WorkNotFoundError } from "@/lib/ai/errors";

/**
 * Read-through cache in front of the LLM call, keyed by workKey. Looks the
 * work up in the `work` table (populated by every search's fire-and-forget
 * persist step — see workPersistence.ts) rather than needing the caller to
 * supply title/abstract, since a summary request is a separate HTTP call from
 * the search that originally surfaced the work.
 */
export async function getOrCreateSummary(workKey: string): Promise<SummaryResult> {
  // "bulk": summaries are the highest-volume LLM job in the app.
  const metered = await meteredLlm("summary", "bulk");
  if (!metered) {
    throw new SummaryFeatureDisabledError();
  }
  const provider = metered.provider;

  const db = getDb();

  const cachedRows = await db
    .select()
    .from(workAiSummary)
    .where(eq(workAiSummary.workKey, workKey))
    .limit(1);
  if (cachedRows[0]) {
    return { summary: cachedRows[0].summary, cached: true };
  }

  const workRows = await db.select().from(work).where(eq(work.workKey, workKey)).limit(1);
  const workRow = workRows[0];
  if (!workRow) {
    throw new WorkNotFoundError(workKey);
  }

  const model = provider.models.cheap;
  const summary = await provider.complete({
    model,
    onUsage: metered.onUsage,
    system: SUMMARY_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Title: ${workRow.title}\n\nAbstract: ${workRow.abstract ?? "(no abstract available)"}`,
      },
    ],
    maxTokens: 300,
  });

  try {
    await db.insert(workAiSummary).values({ workKey, summary, model }).onConflictDoNothing();
  } catch (err) {
    // A cache-write failure must never affect the response — the generated
    // summary above is already returned to the caller regardless.
    logger.warn(
      { event: "summary_cache_write_failed", workKey, err: String(err) },
      "summary cache DB write failed",
    );
  }

  return { summary, cached: false };
}
