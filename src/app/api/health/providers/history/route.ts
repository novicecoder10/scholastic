import { NextRequest, NextResponse } from "next/server";
import { getProviderHealthHistory } from "@/lib/resilience/healthHistory";
import { logger } from "@/lib/log/logger";

const DEFAULT_DAYS = 7;
const MAX_DAYS = 30;

/**
 * Secondary ops view, not core functionality — a DB failure here degrades to
 * an empty history (HTTP 200, `degraded: true`) rather than a hard error,
 * same "never fail the caller" contract used elsewhere in this app.
 */
export async function GET(request: NextRequest) {
  const daysParam = request.nextUrl.searchParams.get("days");
  const parsedDays = daysParam ? Number.parseInt(daysParam, 10) : DEFAULT_DAYS;
  const days = Math.min(
    Math.max(Number.isNaN(parsedDays) ? DEFAULT_DAYS : parsedDays, 1),
    MAX_DAYS,
  );

  try {
    const buckets = await getProviderHealthHistory(days);
    return NextResponse.json({ buckets, degraded: false });
  } catch (err) {
    logger.warn(
      { event: "health_history_query_failed", err: String(err) },
      "provider health history query failed",
    );
    return NextResponse.json({ buckets: [], degraded: true });
  }
}
