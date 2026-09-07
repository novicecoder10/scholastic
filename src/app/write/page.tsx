import type { Metadata } from "next";
import Link from "next/link";
import { ManuscriptList } from "@/components/manuscript/ManuscriptList";
import { isAuthEnabled } from "@/lib/auth/config";
import { verifySession } from "@/lib/auth/dal";
import { listManuscripts } from "@/lib/manuscript/repository";
import { logger } from "@/lib/log/logger";

export const metadata: Metadata = { title: "Write" };
export const dynamic = "force-dynamic";

/**
 * The one feature in this app that requires an account, and the page says why
 * rather than redirecting. A session-scoped manuscript is a data-loss trap
 * dressed as convenience: a cleared cookie would take the writing with it.
 */
export default async function WriteIndexPage() {
  const user = await verifySession();

  if (!user) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-8">
        <h1 className="text-ink text-2xl font-semibold tracking-tight">Write</h1>
        <p className="text-muted mt-2 text-sm">
          A manuscript editor whose citations are live objects rather than typed text. Insert a
          paper from your library and it numbers itself, renumbers when you move a paragraph, and
          reformats when you switch style — the bibliography is derived from the document, never
          stored beside it.
        </p>
        <p className="text-muted mt-4 text-sm">
          {isAuthEnabled() ? (
            <>
              This is the one part of Scholastic that needs an account, because a manuscript tied to
              a browser session would vanish with a cleared cookie.{" "}
              <Link href="/signup?next=%2Fwrite" className="text-link hover:underline">
                Create an account
              </Link>{" "}
              to start writing.
            </>
          ) : (
            <>Accounts aren&apos;t enabled on this instance, so the editor is unavailable here.</>
          )}
        </p>
      </main>
    );
  }

  let manuscripts: Awaited<ReturnType<typeof listManuscripts>> = [];
  try {
    manuscripts = await listManuscripts(user.id);
  } catch (err) {
    logger.warn({ event: "write_index_failed", err: String(err) }, "manuscript list degraded");
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-8">
      <h1 className="text-ink text-2xl font-semibold tracking-tight">Write</h1>
      <p className="text-muted mt-1 mb-6 text-sm">
        Citations are objects here, not typed text. Move a paragraph and the numbering follows.
      </p>
      <ManuscriptList
        manuscripts={manuscripts.map((m) => ({ ...m, updatedAt: m.updatedAt.toISOString() }))}
      />
    </main>
  );
}
