"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export interface LedgerRow {
  id: number;
  delta: number;
  reason: string;
  detail: unknown;
  balanceAfter: number;
  createdAt: string;
}

/** Plain language, because a ledger nobody can read is the trust problem this
 * whole design exists to avoid. */
const REASON_LABELS: Record<string, string> = {
  welcome_grant: "Welcome grant",
  periodic_replenishment: "Monthly top-up",
  publication_verified: "Verified publication",
  peer_review_verified: "Verified peer review",
  spend: "Used",
  refund: "Refunded",
  operator_adjustment: "Adjusted by the operator",
};

function describe(row: LedgerRow): string {
  const detail = (row.detail ?? {}) as Record<string, unknown>;
  if (row.reason === "spend" && typeof detail.feature === "string") {
    return `Used — ${String(detail.feature).replace(/_/g, " ")}`;
  }
  if (typeof detail.title === "string") {
    return `${REASON_LABELS[row.reason] ?? row.reason} — ${detail.title}`;
  }
  return REASON_LABELS[row.reason] ?? row.reason;
}

export function CreditsView({
  balance,
  ledger,
  costs,
  orcid,
  orcidConfigured,
  notice,
}: {
  balance: number;
  ledger: LedgerRow[];
  costs: Array<{ feature: string; estimate: number }>;
  orcid: string | null;
  orcidConfigured: boolean;
  notice: string | null;
}) {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const router = useRouter();

  async function checkContributions() {
    setChecking(true);
    setResult(null);
    try {
      const response = await fetch("/api/credits/check-contributions", { method: "POST" });
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        granted?: number;
        credits?: number;
        alreadyCounted?: number;
      } | null;
      if (!response.ok) {
        setResult(body?.error ?? "Couldn't check your contributions.");
        return;
      }
      setResult(
        body?.granted
          ? `Granted ${body.credits} credits for ${body.granted} new contribution${
              body.granted === 1 ? "" : "s"
            }.`
          : `Nothing new — ${body?.alreadyCounted ?? 0} contributions were already counted.`,
      );
      router.refresh();
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="space-y-8">
      {notice && (
        <p className="border-line bg-surface text-ink rounded-xl border p-3 text-sm" role="status">
          {notice}
        </p>
      )}

      <section className="border-line bg-surface rounded-xl border p-5">
        <p className="text-muted text-xs tracking-wide uppercase">Balance</p>
        <p className="metric text-ink mt-1 text-3xl">{balance}</p>
        <p className="text-muted mt-2 text-sm">
          Credits are never for sale and can&apos;t be transferred. They&apos;re how a shared pool
          of donated AI capacity is split fairly — see{" "}
          <Link href="/sponsors" className="text-link hover:underline">
            who contributes it
          </Link>
          .
        </p>
      </section>

      <section>
        <h2 className="text-ink text-sm font-semibold">Earning more</h2>
        {orcidConfigured ? (
          orcid ? (
            <div className="mt-2 space-y-2">
              <p className="text-muted text-sm">
                Verified as <span className="metric text-ink">{orcid}</span>. Credits are granted
                for publications indexed against that iD and for peer reviews on your ORCID record.
              </p>
              <button
                type="button"
                onClick={() => void checkContributions()}
                disabled={checking}
                className="border-line text-muted hover:border-accent hover:text-accent rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50"
              >
                {checking ? "Checking…" : "Check for new contributions"}
              </button>
              {result && (
                <p className="text-ink text-sm" role="status">
                  {result}
                </p>
              )}
            </div>
          ) : (
            <div className="mt-2 space-y-2">
              <p className="text-muted text-sm">
                Verify your ORCID iD to earn credits for published work and peer review. An iD typed
                into a box would prove nothing, so this goes through ORCID itself.
              </p>
              <a
                href="/api/orcid/start"
                className="bg-accent-solid text-accent-ink inline-block rounded-full px-3 py-1.5 text-sm font-medium"
              >
                Verify with ORCID
              </a>
            </div>
          )
        ) : (
          <p className="text-muted mt-2 text-sm">
            ORCID verification isn&apos;t enabled on this instance, so contribution credits are off.
            The welcome grant and the monthly top-up still apply.
          </p>
        )}
        <p className="text-muted mt-3 text-sm">
          Credits are never earned by using the app. Farming a commons is farming other researchers.
        </p>
      </section>

      <section>
        <h2 className="text-ink text-sm font-semibold">What things cost</h2>
        <p className="text-muted mt-1 text-sm">
          Search, reading PDFs, citations, collections and the citation graph are free and always
          will be — they cost no incremental money. Only model calls are metered, and the figures
          below are estimates: you&apos;re charged for the tokens actually used.
        </p>
        <ul className="border-line divide-line mt-3 divide-y rounded-xl border text-sm">
          {costs.map((cost) => (
            <li key={cost.feature} className="flex items-center justify-between px-4 py-2">
              <span className="text-ink">{cost.feature.replace(/_/g, " ")}</span>
              <span className="metric text-muted">~{cost.estimate}</span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-ink text-sm font-semibold">History</h2>
        {ledger.length === 0 ? (
          <p className="text-muted mt-2 text-sm">Nothing yet.</p>
        ) : (
          <ul className="border-line divide-line mt-3 divide-y rounded-xl border text-sm">
            {ledger.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-4 px-4 py-2">
                <span className="text-ink min-w-0 flex-1 truncate">{describe(row)}</span>
                <span className="text-muted text-xs">
                  {new Date(row.createdAt).toLocaleDateString()}
                </span>
                <span className={`metric ${row.delta < 0 ? "text-muted" : "text-accent"}`}>
                  {row.delta > 0 ? `+${row.delta}` : row.delta}
                </span>
                <span className="metric text-muted w-12 text-right text-xs">{row.balanceAfter}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
