import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { CreditsView } from "@/components/credits/CreditsView";
import { requireUser } from "@/lib/auth/dal";
import { getDb } from "@/lib/db/client";
import { orcidIdentity } from "@/lib/db/schema";
import { costTable } from "@/lib/credits/cost";
import { getBalance, history } from "@/lib/credits/ledger";
import { isOrcidConfigured } from "@/lib/orcid/oauth";
import { logger } from "@/lib/log/logger";

export const metadata: Metadata = { title: "Credits" };
export const dynamic = "force-dynamic";

/** Private, always. There is no leaderboard, no public badge and no profile —
 * a credit score attached to a researcher and shown publicly is a reputation
 * metric, and academia's existing ones have a well-documented history of being
 * gamed. Keeping balances private removes the incentive structurally. */
const ORCID_NOTICES: Record<string, string> = {
  linked: "ORCID iD verified. Check for contributions to claim credits for your published work.",
  taken: "That ORCID iD is already verified on another account.",
  state: "That verification link didn't come from here, so it was ignored. Try again.",
  denied: "ORCID verification was cancelled.",
  failed: "ORCID couldn't confirm that iD. Nothing was changed.",
};

interface PageProps {
  searchParams: Promise<{ orcid?: string }>;
}

export default async function CreditsPage({ searchParams }: PageProps) {
  const user = await requireUser("/credits");
  const { orcid: notice } = await searchParams;

  let balance = 0;
  let ledger: Awaited<ReturnType<typeof history>> = [];
  let orcid: string | null = null;
  try {
    [balance, ledger] = await Promise.all([getBalance(user.id), history(user.id)]);
    const [identity] = await getDb()
      .select()
      .from(orcidIdentity)
      .where(eq(orcidIdentity.userId, user.id))
      .limit(1);
    orcid = identity?.orcid ?? null;
  } catch (err) {
    // Fail open here too: an unreadable ledger means AI features are running
    // unmetered right now, so a page saying "0 credits" would be actively
    // misleading. It says nothing instead.
    logger.warn({ event: "credits_page_load_failed", err: String(err) }, "credits page degraded");
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-8">
      <h1 className="text-ink text-2xl font-semibold tracking-tight">Credits</h1>
      <p className="text-muted mt-1 mb-6 text-sm">
        Your share of a donated pool of AI capacity, and where it came from.
      </p>
      <CreditsView
        balance={balance}
        ledger={ledger.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }))}
        costs={costTable()}
        orcid={orcid}
        orcidConfigured={isOrcidConfigured()}
        notice={notice ? (ORCID_NOTICES[notice] ?? null) : null}
      />
    </main>
  );
}
