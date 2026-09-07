"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { SearchBar } from "@/components/search/SearchBar";
import type { SearchMode } from "@/lib/types/search";
import { AccountMenu } from "@/components/auth/AccountMenu";

/**
 * The wordmark's glyph: nine ticks, one per data source this app aggregates.
 * It's the same device the result cards use for per-result provenance, so the
 * mark states what the product actually does rather than decorating the name.
 */
function SourceSpineMark() {
  return (
    <span aria-hidden="true" className="flex h-5 items-end gap-[2px]">
      {[7, 12, 9, 16, 11, 20, 10, 14, 8].map((height, i) => (
        <span
          key={i}
          className="bg-accent w-[2px] rounded-full"
          style={{ height: `${height}px`, opacity: 0.45 + (height / 20) * 0.55 }}
        />
      ))}
    </span>
  );
}

function NavLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`rounded-md px-2.5 py-1.5 text-sm transition-colors ${
        active ? "bg-surface-2 text-ink" : "text-muted hover:text-ink"
      }`}
    >
      {children}
    </Link>
  );
}

export function TopNav({
  user,
  authEnabled,
}: {
  /** Resolved server-side in the layout, so the nav never flashes a signed-out
   * state on first paint for a signed-in user. */
  user: { name: string; email: string } | null;
  authEnabled: boolean;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.get("q")?.trim() ?? "";
  const mode: SearchMode = searchParams.get("mode") === "semantic" ? "semantic" : "keyword";

  // The homepage's large task box is the sole search entry point until a query
  // is actually running; only then does the compact nav input take over.
  const showCompactSearch = query.length > 0;

  return (
    <header className="border-line bg-nav/95 sticky top-0 z-30 border-b backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-4 px-4 sm:px-8">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <SourceSpineMark />
          <span className="text-ink text-[15px] font-semibold tracking-tight">Scholastic</span>
        </Link>

        <div className="flex-1">
          {showCompactSearch && (
            <div className="mx-auto max-w-xl">
              <SearchBar key={query} initialQuery={query} initialMode={mode} variant="compact" />
            </div>
          )}
        </div>

        <nav aria-label="Main" className="flex shrink-0 items-center gap-1">
          <NavLink href="/" active={pathname === "/"}>
            Search
          </NavLink>
          <NavLink href="/reader" active={pathname.startsWith("/reader")}>
            Reader
          </NavLink>
          <NavLink href="/library" active={pathname.startsWith("/library")}>
            Library
          </NavLink>
          <NavLink href="/graph" active={pathname.startsWith("/graph")}>
            Graph
          </NavLink>
          <NavLink href="/write" active={pathname.startsWith("/write")}>
            Write
          </NavLink>
          <NavLink href="/matrix" active={pathname.startsWith("/matrix")}>
            Matrix
          </NavLink>
          <NavLink href="/present" active={pathname.startsWith("/present")}>
            Present
          </NavLink>
          <NavLink href="/sponsors" active={pathname === "/sponsors"}>
            Sponsors
          </NavLink>
          <NavLink href="/health" active={pathname === "/health"}>
            Health
          </NavLink>
          <AccountMenu
            email={user?.email ?? null}
            name={user?.name ?? null}
            authEnabled={authEnabled}
          />
        </nav>
      </div>
    </header>
  );
}
