import type { Metadata } from "next";
import Link from "next/link";
import { LibraryView } from "@/components/library/LibraryView";
import { isAuthEnabled } from "@/lib/auth/config";
import { verifySession } from "@/lib/auth/dal";
import { readOwner } from "@/lib/auth/owner";
import { listCollections, listSavedItems } from "@/lib/library/repository";
import { listOwned } from "@/lib/documents/repository";
import { logger } from "@/lib/log/logger";

export const metadata: Metadata = { title: "Library" };
export const dynamic = "force-dynamic";

/**
 * Deliberately reachable signed out.
 *
 * An anonymous visitor sees the uploads they already have, with a line about
 * keeping them. Hiding the page behind a redirect would make the app look
 * smaller than it is and hide documents the visitor can already open.
 */
export default async function LibraryPage() {
  const user = await verifySession();

  if (!user) {
    const owner = await readOwner();
    let documents: Awaited<ReturnType<typeof listOwned>> = [];
    if (owner) {
      try {
        documents = await listOwned(owner);
      } catch (err) {
        logger.warn({ event: "library_anon_list_failed", err: String(err) }, "list failed");
      }
    }

    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-8">
        <h1 className="text-ink text-2xl font-semibold tracking-tight">Library</h1>
        <p className="text-muted mt-1 mb-6 text-sm">
          {isAuthEnabled() ? (
            <>
              These uploads belong to this browser.{" "}
              <Link href="/signup?next=%2Flibrary" className="text-link hover:underline">
                Create an account
              </Link>{" "}
              to keep them and to save papers from search.
            </>
          ) : (
            <>
              Accounts aren&apos;t enabled on this instance, so these uploads belong to this browser
              and stay on this device.
            </>
          )}
        </p>

        {documents.length === 0 ? (
          <p className="text-muted text-sm">
            Nothing here yet. Upload a PDF in the{" "}
            <Link href="/reader" className="text-link hover:underline">
              Reader
            </Link>
            .
          </p>
        ) : (
          <ul className="divide-line border-line divide-y rounded-xl border">
            {documents.map((doc) => (
              <li key={doc.documentId} className="px-4 py-3">
                <Link
                  href={`/reader/${encodeURIComponent(doc.documentId)}`}
                  className="text-link text-sm font-medium hover:underline"
                >
                  {doc.title ?? doc.filename}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    );
  }

  const [papers, documents, collections] = await Promise.all([
    listSavedItems(user.id, "work"),
    listSavedItems(user.id, "document"),
    listCollections(user.id),
  ]);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-8">
      <h1 className="text-ink text-2xl font-semibold tracking-tight">Library</h1>
      <p className="text-muted mt-1 mb-6 text-sm">Saved papers, your uploads, and collections.</p>
      <LibraryView
        papers={papers.map((p) => ({ ...p, savedAt: p.savedAt.toISOString() }))}
        documents={documents.map((d) => ({ ...d, savedAt: d.savedAt.toISOString() }))}
        collections={collections}
      />
    </main>
  );
}
