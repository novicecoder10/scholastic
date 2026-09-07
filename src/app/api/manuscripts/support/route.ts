import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth/apiGuard";
import { listSavedItems } from "@/lib/library/repository";
import { rankBySemanticSimilarity } from "@/lib/ai/semanticRank";
import { performSearch } from "@/lib/search";
import type { CanonicalWork } from "@/lib/types/work";
import { logger } from "@/lib/log/logger";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_CLAIM_CHARS = 600;
const MAX_CANDIDATES = 8;

/**
 * Candidate works for a claim the writer has selected. It **suggests**; it
 * never attaches anything.
 *
 * That is a correctness rule rather than a UI default. A wrong citation is
 * worse than no citation: it reads as authoritative, it is rarely re-checked,
 * and it survives into the published version. There is deliberately no
 * confidence threshold above which this inserts on its own.
 */
export async function POST(request: NextRequest) {
  const auth = await requireUserApi();
  if ("response" in auth) return auth.response;

  let body: { claim?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const claim = typeof body.claim === "string" ? body.claim.trim() : "";
  if (!claim) return NextResponse.json({ error: "Select a claim first." }, { status: 400 });
  if (claim.length > MAX_CLAIM_CHARS) {
    return NextResponse.json(
      { error: `Select less text — the limit is ${MAX_CLAIM_CHARS} characters.` },
      { status: 400 },
    );
  }

  try {
    // The library first, ranked semantically: a researcher's own collection is
    // where the citation they actually meant almost always is, and searching it
    // costs one embedding rather than nine provider calls.
    const saved = await listSavedItems(auth.user.id, "work");
    const library = saved
      .map((item) => item.workSnapshot as CanonicalWork | null)
      .filter((work): work is CanonicalWork => Boolean(work));

    const fromLibrary = library.length > 0 ? await rankBySemanticSimilarity(library, claim) : [];

    let fromSearch: CanonicalWork[] = [];
    if (fromLibrary.length < MAX_CANDIDATES) {
      try {
        const response = await performSearch({ q: claim, mode: "semantic", perPage: 10 });
        const known = new Set(library.map((w) => w.workKey));
        fromSearch = response.results.filter((w) => !known.has(w.workKey));
      } catch (err) {
        // A search failure narrows the suggestions to the library rather than
        // failing the operation — the library half is the useful half.
        logger.warn({ event: "support_search_failed", err: String(err) }, "support search failed");
      }
    }

    const candidates = [
      ...fromLibrary.map((work) => ({ work, source: "library" as const })),
      ...fromSearch.map((work) => ({ work, source: "search" as const })),
    ].slice(0, MAX_CANDIDATES);

    return NextResponse.json({
      candidates: candidates.map(({ work, source }) => ({
        workKey: work.workKey,
        title: work.title,
        authors: work.authors.slice(0, 3).map((a) => a.name),
        year: work.year,
        venue: work.venue,
        source,
      })),
    });
  } catch (err) {
    logger.error({ event: "find_support_failed", err: String(err) }, "find support failed");
    return NextResponse.json({ error: "Couldn't look for support." }, { status: 503 });
  }
}
