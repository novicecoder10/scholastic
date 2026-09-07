import { NextRequest, NextResponse } from "next/server";
import { understandQuery, type QueryUnderstandingTurn } from "@/lib/ai/queryUnderstanding";

interface RequestBody {
  input: string;
  priorTurns?: QueryUnderstandingTurn[];
}

function isValidPriorTurns(value: unknown): value is QueryUnderstandingTurn[] {
  if (value === undefined) return true;
  return (
    Array.isArray(value) &&
    value.every(
      (t) =>
        typeof t === "object" &&
        t !== null &&
        typeof t.question === "string" &&
        typeof t.answer === "string",
    )
  );
}

/**
 * POST — triggers a real (if cheap) LLM call, same cost-signaling rationale
 * as summary's POST-not-GET. Never returns an error for "LLM unavailable" or
 * "LLM output malformed" — `understandQuery` itself degrades to a literal-
 * query fallback for all of those, since a query-understanding failure must
 * never break search. Only truly malformed requests (bad JSON, missing
 * `input`) get a 400.
 */
export async function POST(request: NextRequest) {
  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.input !== "string" || !body.input.trim()) {
    return NextResponse.json({ error: "'input' is required" }, { status: 400 });
  }
  if (!isValidPriorTurns(body.priorTurns)) {
    return NextResponse.json(
      { error: "'priorTurns' must be an array of {question, answer}" },
      { status: 400 },
    );
  }

  const result = await understandQuery(body.input, body.priorTurns);
  return NextResponse.json(result);
}
