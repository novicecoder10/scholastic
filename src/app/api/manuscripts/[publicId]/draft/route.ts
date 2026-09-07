import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth/apiGuard";
import { insufficientCreditsResponse, isInsufficientCredits } from "@/lib/credits/apiResponse";
import { NO_LLM_PROVIDER_MESSAGE } from "@/lib/ai/llm";
import { generateGroundedDraft, type DraftSource } from "@/lib/manuscript/draft";
import { findManuscript } from "@/lib/manuscript/repository";
import { listSavedItems } from "@/lib/library/repository";
import { sentenceSegments } from "@/lib/manuscript/draftGuard";
import type { CanonicalWork } from "@/lib/types/work";
import { logger } from "@/lib/log/logger";

export const runtime = "nodejs";
export const maxDuration = 120;

interface RouteParams {
  params: Promise<{ publicId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await requireUserApi();
  if ("response" in auth) return auth.response;
  const { publicId } = await params;

  let body: { topic?: unknown; workKeys?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const topic = typeof body.topic === "string" ? body.topic.trim() : "";
  if (!topic) return NextResponse.json({ error: "A section topic is required." }, { status: 400 });
  if (!Array.isArray(body.workKeys) || body.workKeys.length === 0) {
    return NextResponse.json({ error: "Choose at least one source." }, { status: 400 });
  }

  try {
    if (!(await findManuscript(auth.user.id, publicId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Sources come from the user's own saved papers, so a draft can only cite
    // work they have actually collected — and the snapshot is what #4's
    // formatters will later render, so the citation and the bibliography agree
    // by construction.
    const wanted = new Set(body.workKeys.filter((k): k is string => typeof k === "string"));
    const saved = await listSavedItems(auth.user.id, "work");
    const sources: DraftSource[] = saved
      .filter((item) => item.workKey && wanted.has(item.workKey))
      .map((item) => {
        const snapshot = item.workSnapshot as CanonicalWork | null;
        return {
          workKey: item.workKey!,
          title: snapshot?.title ?? item.workKey!,
          abstract: snapshot?.abstract ?? null,
        };
      });

    if (sources.length === 0) {
      return NextResponse.json(
        { error: "None of those sources are in your library." },
        { status: 400 },
      );
    }

    const result = await generateGroundedDraft(topic, sources);
    if (!result) {
      return NextResponse.json(
        { error: `Drafting is not configured on this instance — ${NO_LLM_PROVIDER_MESSAGE}` },
        { status: 503 },
      );
    }

    // Nothing survived the guard. Saying so beats inserting unattributed prose
    // into someone's manuscript, and beats inserting nothing silently.
    if (result.empty) {
      return NextResponse.json({
        inserted: false,
        reason:
          "Every sentence came back without a usable citation, so nothing was inserted. Try a narrower section topic, or add more sources.",
        droppedUncited: result.draft.droppedUncited,
        droppedForeign: result.draft.droppedForeign,
      });
    }

    return NextResponse.json({
      inserted: true,
      sentences: result.draft.sentences.map((sentence) => sentenceSegments(sentence)),
      droppedUncited: result.draft.droppedUncited,
      droppedForeign: result.draft.droppedForeign,
    });
  } catch (err) {
    if (isInsufficientCredits(err)) return insufficientCreditsResponse(err);
    logger.error({ event: "grounded_draft_failed", err: String(err) }, "grounded draft failed");
    return NextResponse.json({ error: "Couldn't draft that section." }, { status: 503 });
  }
}
