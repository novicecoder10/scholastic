import { NextRequest, NextResponse } from "next/server";
import { generateDeckOutline } from "@/lib/deck/generate";
import { renderDeckMarkdown } from "@/lib/deck/export";
import { collectDeckWorkKeys } from "@/lib/deck/outline";
import { isManuscriptStyle } from "@/lib/manuscript/bibliography";
import { insufficientCreditsResponse, isInsufficientCredits } from "@/lib/credits/apiResponse";
import { NO_LLM_PROVIDER_MESSAGE } from "@/lib/ai/llm";
import { performSearch } from "@/lib/search";
import type { CanonicalWork } from "@/lib/types/work";
import type { CitationStyle } from "@/lib/citations";
import { attributionHeaders } from "@/lib/capacity/attribution";
import { logger } from "@/lib/log/logger";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_TOPIC = 300;

/** Enough for a 5-7 slide deck to have something to say on each; the context
 * builder ranks and keeps the best 8 of them anyway. */
const SOURCE_COUNT = 12;

/**
 * Search, then outline what was found — one request, because a deck built from
 * a *different* set of papers than the ones shown would be a deck the user
 * cannot check.
 *
 * The works come back with the outline for exactly that reason: the page lists
 * every paper the deck was built from, so "where did this bullet come from" is
 * answerable without another lookup.
 */
export async function POST(request: NextRequest) {
  let body: { topic?: unknown; style?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const topic = typeof body.topic === "string" ? body.topic.trim() : "";
  if (!topic) return NextResponse.json({ error: "A topic is required." }, { status: 400 });
  if (topic.length > MAX_TOPIC) {
    return NextResponse.json(
      { error: `Topics are limited to ${MAX_TOPIC} characters.` },
      { status: 400 },
    );
  }
  const style: CitationStyle =
    typeof body.style === "string" && isManuscriptStyle(body.style) ? body.style : "apa";

  let works: CanonicalWork[] = [];
  try {
    const response = await performSearch({ q: topic, perPage: SOURCE_COUNT });
    works = response.results;
  } catch (err) {
    logger.error({ event: "deck_search_failed", err: String(err) }, "deck search failed");
    return NextResponse.json(
      { error: "Couldn't reach the search providers to gather sources." },
      { status: 503 },
    );
  }

  if (works.length === 0) {
    return NextResponse.json(
      { error: "No papers came back for that topic, so there is nothing to build a deck from." },
      { status: 404 },
    );
  }

  try {
    const result = await generateDeckOutline(
      topic,
      works.map((w) => ({ workKey: w.workKey, title: w.title, abstract: w.abstract })),
    );

    if (!result) {
      return NextResponse.json(
        { error: `Presentations are not configured on this instance — ${NO_LLM_PROVIDER_MESSAGE}` },
        { status: 503 },
      );
    }

    // Resolved straight from the search results rather than through the
    // manuscript resolver: these are the works the deck was just built from, so
    // a database round-trip could only disagree with them.
    const resolved = new Map<string, CanonicalWork | null>(works.map((w) => [w.workKey, w]));
    // Ordered by first appearance in the deck, not by search rank: the numbers
    // the page shows against each bullet are positions in this list, and the
    // exported reference slide numbers the same way. Two orderings would put a
    // bullet's [3] next to a different paper's [3].
    const cited = collectDeckWorkKeys(result.outline);
    const byKey = new Map(works.map((w) => [w.workKey, w]));

    return NextResponse.json(
      {
        topic,
        style,
        outline: result.outline,
        empty: result.empty,
        sponsor: result.sponsor,
        markdown: renderDeckMarkdown(topic, result.outline, resolved, style),
        sources: cited
          .map((key) => byKey.get(key))
          .filter((w): w is CanonicalWork => Boolean(w))
          .map((w) => ({
            workKey: w.workKey,
            title: w.title,
            year: w.year,
            doi: w.doi,
            landingPageUrl: w.landingPageUrl,
          })),
        searched: works.length,
      },
      { headers: attributionHeaders(result.sponsor) },
    );
  } catch (err) {
    if (isInsufficientCredits(err)) return insufficientCreditsResponse(err);
    logger.error({ event: "deck_outline_failed", err: String(err) }, "deck outline failed");
    return NextResponse.json({ error: "Couldn't build that deck right now." }, { status: 503 });
  }
}
