import type { Metadata } from "next";
import Link from "next/link";
import { poolHealth, publicSponsors } from "@/lib/capacity/sources";
import { logger } from "@/lib/log/logger";

export const metadata: Metadata = { title: "Sponsors" };
export const dynamic = "force-dynamic";

/**
 * Public, and deliberately thin: sponsor name, link, and how much of the pool
 * they carry. No per-user data appears here, ever — this page is about who
 * donated capacity, not about who used it.
 */
export default async function SponsorsPage() {
  let sponsors: Awaited<ReturnType<typeof publicSponsors>> = [];
  let health = { activeSources: 0, sponsoredSources: 0, exhaustedSources: 0, dormantSources: 0 };
  try {
    [sponsors, health] = await Promise.all([publicSponsors(), poolHealth()]);
  } catch (err) {
    logger.warn({ event: "sponsors_page_load_failed", err: String(err) }, "sponsors page degraded");
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-8">
      <h1 className="text-ink text-2xl font-semibold tracking-tight">Sponsors</h1>
      <p className="text-muted mt-1 mb-6 text-sm">
        Scholastic runs on donated AI capacity. Sponsors contribute quota freely — there is no tier,
        no priority, and no influence over who gets served.
      </p>

      <section className="border-line bg-surface mb-8 flex flex-wrap gap-6 rounded-xl border p-5">
        <div>
          <p className="text-muted text-xs tracking-wide uppercase">Active sources</p>
          <p className="metric text-ink mt-1 text-2xl">{health.activeSources}</p>
        </div>
        <div>
          <p className="text-muted text-xs tracking-wide uppercase">Sponsored</p>
          <p className="metric text-ink mt-1 text-2xl">{health.sponsoredSources}</p>
        </div>
        <div>
          <p className="text-muted text-xs tracking-wide uppercase">Exhausted this month</p>
          <p className="metric text-ink mt-1 text-2xl">{health.exhaustedSources}</p>
        </div>
        <div>
          <p className="text-muted text-xs tracking-wide uppercase">Resting</p>
          <p className="metric text-ink mt-1 text-2xl">{health.dormantSources}</p>
          <p className="text-muted mt-1 text-xs">Rate-limited; back automatically</p>
        </div>
      </section>

      {sponsors.length === 0 ? (
        <p className="text-muted text-sm">
          No sponsors listed yet — this instance runs on its operator&apos;s own capacity.
        </p>
      ) : (
        <ul className="border-line divide-line divide-y rounded-xl border">
          {sponsors.map((sponsor) => (
            <li key={sponsor.label} className="flex items-baseline justify-between px-4 py-3">
              <span className="text-ink text-sm font-medium">
                {sponsor.sponsorUrl ? (
                  <a
                    href={sponsor.sponsorUrl}
                    rel="noopener noreferrer nofollow"
                    target="_blank"
                    className="text-link hover:underline"
                  >
                    {sponsor.sponsorName}
                  </a>
                ) : (
                  sponsor.sponsorName
                )}
              </span>
              <span className="metric text-muted text-xs">
                {sponsor.tokensUsedPeriod.toLocaleString()} tokens this month
              </span>
            </li>
          ))}
        </ul>
      )}

      <section className="mt-8">
        <h2 className="text-ink text-sm font-semibold">Three ways to contribute capacity</h2>
        <ul className="text-muted mt-2 space-y-2 text-sm">
          <li>
            <span className="text-ink">A key you hold.</span> The operator puts it in the
            environment; the database records only the variable&apos;s name.
          </li>
          <li>
            <span className="text-ink">A relay you run.</span> If your grant terms forbid handing
            the key to anyone, expose a scoped OpenAI-compatible URL instead and keep custody of it.
            You enforce your own spend limits, and you revoke access by switching it off.
          </li>
          <li>
            <span className="text-ink">Hours on a cluster.</span> A GPU node donated for the hours
            it is otherwise idle — evenings and weekends, on whatever schedule you set.
          </li>
        </ul>
        <p className="text-muted mt-4 text-sm">
          All three are arranged with the operator directly. This app never accepts an API key
          through a web form, and no page here will ever ask you for one. See{" "}
          <Link href="/credits" className="text-link hover:underline">
            Credits
          </Link>{" "}
          for how the pool is shared out.
        </p>
      </section>
    </main>
  );
}
