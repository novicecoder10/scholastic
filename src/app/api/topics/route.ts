import { NextRequest, NextResponse } from "next/server";
import { aggregateTopics, dropUniversalTopics } from "@/lib/topics/aggregate";
import { labelTopics, type LabelledTheme } from "@/lib/topics/label";
import type { CanonicalWork } from "@/lib/types/work";

export interface TopicsRequestBody {
  /** The current result set, client-supplied for the same reason
   * `/api/chat`'s `works` is: the client already holds it, and a server-side
   * `work`-table lookup would introduce a DB dependency with no defined
   * degradation. Only workKey and topics are read. */
  works: Array<Pick<CanonicalWork, "workKey" | "topics">>;
}

export interface TopicsResponse {
  concepts: Array<{ name: string; count: number; workKeys: string[] }>;
  /** Null when no LLM is configured or labelling produced nothing usable. The
   * client then renders `concepts` unlabelled — less polished, still useful. */
  themes: LabelledTheme[] | null;
}

function isValidWorks(value: unknown): value is TopicsRequestBody["works"] {
  return (
    Array.isArray(value) &&
    value.every(
      (w) =>
        typeof w === "object" &&
        w !== null &&
        typeof w.workKey === "string" &&
        (w.topics === undefined || Array.isArray(w.topics)),
    )
  );
}

/**
 * POST rather than GET: the request body is a result set too large for a query
 * string, and step 3 spends an LLM call. Same cost-signalling rationale as the
 * summary and query-understanding routes.
 */
export async function POST(request: NextRequest) {
  let body: TopicsRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isValidWorks(body.works)) {
    return NextResponse.json(
      { error: "'works' must be an array of {workKey, topics}" },
      { status: 400 },
    );
  }

  const aggregated = dropUniversalTopics(
    aggregateTopics(body.works as CanonicalWork[]),
    body.works.length,
  );

  // No 503 for a missing LLM here, unlike the chat routes: aggregation alone
  // is a complete, useful answer, so an unlabelled list is a success.
  const themes = await labelTopics(aggregated);

  const response: TopicsResponse = {
    concepts: aggregated.map(({ name, count, workKeys }) => ({ name, count, workKeys })),
    themes,
  };
  return NextResponse.json(response);
}
