import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { citationReasoningCache, work } from "@/lib/db/schema";
import { getSemanticScholarAbstract } from "@/lib/providers/semanticscholar/citations";
import { NO_LLM_PROVIDER_MESSAGE } from "@/lib/ai/llm";
import { meteredLlm } from "@/lib/credits/metered";
import { normalizeDoi } from "@/lib/merge/normalize";
import { logger } from "@/lib/log/logger";

const SYSTEM_PROMPT =
  "You explain the relationship between two academic papers connected by a citation — " +
  "specifically why the citing paper cites the cited paper (e.g. builds on its method, " +
  "contradicts a finding, uses it as a baseline, extends its dataset). Ground your answer only " +
  "in the abstracts provided. If the abstracts don't make the relationship clear, say so " +
  "plainly rather than guessing. 2-3 sentences, no preamble.";

const NOT_ENOUGH_INFO_MESSAGE =
  "Not enough information to explain this relationship — an abstract isn't available for one or both papers.";

export class CitationReasoningDisabledError extends Error {
  constructor() {
    super(`Citation reasoning is not configured on this instance — ${NO_LLM_PROVIDER_MESSAGE}`);
    this.name = "CitationReasoningDisabledError";
  }
}

export interface CitationReasoningResult {
  reasoning: string;
  cached: boolean;
}

/** The root paper's abstract may already be in the `work` table (if it was
 * ever searched for directly); otherwise — or for the other side of the pair,
 * which usually was only ever reached via a citation edge — fall back to a
 * targeted Semantic Scholar lookup. */
async function getAbstractForDoi(doi: string): Promise<string | null> {
  try {
    const db = getDb();
    const rows = await db.select().from(work).where(eq(work.doi, doi)).limit(1);
    if (rows[0]?.abstract) return rows[0].abstract;
  } catch {
    // No DB, or lookup failed — fall through to the live targeted lookup.
  }

  try {
    return await getSemanticScholarAbstract(doi);
  } catch (err) {
    logger.warn(
      { event: "citation_reasoning_abstract_lookup_failed", doi, err: String(err) },
      "abstract lookup failed",
    );
    return null;
  }
}

/**
 * Given a citing→cited DOI pair, explains why the relationship exists.
 * Requires both abstracts; if either is unavailable, returns a clear decline
 * rather than reasoning from titles alone — titles-only speculation would
 * contradict this codebase's "say so plainly rather than guessing" ethos
 * (see /api/chat's own system prompt).
 */
export async function getCitationReasoning(
  citingDoi: string,
  citedDoi: string,
): Promise<CitationReasoningResult> {
  const metered = await meteredLlm("citation_reasoning", "quality");
  if (!metered) throw new CitationReasoningDisabledError();
  const provider = metered.provider;

  const normalizedCiting = normalizeDoi(citingDoi) ?? citingDoi;
  const normalizedCited = normalizeDoi(citedDoi) ?? citedDoi;

  const db = getDb();
  const cachedRows = await db
    .select()
    .from(citationReasoningCache)
    .where(
      and(
        eq(citationReasoningCache.citingDoi, normalizedCiting),
        eq(citationReasoningCache.citedDoi, normalizedCited),
      ),
    )
    .limit(1);
  if (cachedRows[0]) {
    return { reasoning: cachedRows[0].reasoning, cached: true };
  }

  const [citingAbstract, citedAbstract] = await Promise.all([
    getAbstractForDoi(normalizedCiting),
    getAbstractForDoi(normalizedCited),
  ]);

  if (!citingAbstract || !citedAbstract) {
    return { reasoning: NOT_ENOUGH_INFO_MESSAGE, cached: false };
  }

  const model = provider.models.cheap;
  const reasoning = await provider.complete({
    model,
    onUsage: metered.onUsage,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Citing paper abstract: ${citingAbstract}\n\nCited paper abstract: ${citedAbstract}`,
      },
    ],
    maxTokens: 250,
  });

  try {
    await db
      .insert(citationReasoningCache)
      .values({ citingDoi: normalizedCiting, citedDoi: normalizedCited, reasoning, model })
      .onConflictDoNothing();
  } catch (err) {
    // A cache-write failure must never affect the response — the generated
    // reasoning above is already returned to the caller regardless.
    logger.warn(
      { event: "citation_reasoning_cache_write_failed", err: String(err) },
      "citation reasoning cache write failed",
    );
  }

  return { reasoning, cached: false };
}
