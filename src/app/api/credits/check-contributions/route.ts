import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth/apiGuard";
import { getDb } from "@/lib/db/client";
import { orcidIdentity } from "@/lib/db/schema";
import { grantForContributions } from "@/lib/credits/grants";
import { fetchContributions } from "@/lib/orcid/contributions";
import { isOrcidConfigured, ORCID_DISABLED_MESSAGE } from "@/lib/orcid/oauth";
import { logger } from "@/lib/log/logger";

export const runtime = "nodejs";

/**
 * On demand, never on a schedule: the user asks, and sees what changed. A
 * background job that silently moved someone's balance would be harder to
 * explain than a button they pressed, and this is a system whose whole premise
 * is that its accounting is explainable.
 *
 * Idempotent by external id, so pressing it twice in a row grants nothing the
 * second time and says so.
 */
export async function POST() {
  const auth = await requireUserApi();
  if ("response" in auth) return auth.response;
  if (!isOrcidConfigured()) {
    return NextResponse.json({ error: ORCID_DISABLED_MESSAGE }, { status: 503 });
  }

  try {
    const [identity] = await getDb()
      .select()
      .from(orcidIdentity)
      .where(eq(orcidIdentity.userId, auth.user.id))
      .limit(1);

    if (!identity) {
      return NextResponse.json(
        { error: "Verify your ORCID iD first — credits are only granted for verified work." },
        { status: 400 },
      );
    }

    const contributions = await fetchContributions(identity.orcid);
    const result = await grantForContributions(auth.user.id, contributions);

    await getDb()
      .update(orcidIdentity)
      .set({ lastCheckedAt: new Date() })
      .where(eq(orcidIdentity.userId, auth.user.id));

    return NextResponse.json({
      checked: contributions.length,
      ...result,
    });
  } catch (err) {
    logger.error(
      { event: "contribution_check_failed", err: String(err) },
      "contribution check failed",
    );
    return NextResponse.json({ error: "Couldn't check your contributions." }, { status: 503 });
  }
}
