"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CanonicalWork } from "@/lib/types/work";

interface SavedItem {
  id: number;
  itemType: "work" | "document";
  workKey: string | null;
  documentId: string | null;
  workSnapshot: CanonicalWork | null;
  note: string | null;
  savedAt: string;
  filename: string | null;
}

interface CollectionSummary {
  publicId: string;
  name: string;
  description: string | null;
  itemCount: number;
}

type Tab = "papers" | "documents" | "collections";

export function LibraryView({
  papers,
  documents,
  collections,
}: {
  papers: SavedItem[];
  documents: SavedItem[];
  collections: CollectionSummary[];
}) {
  const [tab, setTab] = useState<Tab>("papers");
  const [creating, setCreating] = useState(false);
  /**
   * Collections created in this session, shown immediately.
   *
   * router.refresh() below is still the source of truth, but it re-renders the
   * page on the server and can take a second or two to land — long enough that
   * a collection you just created appears to have vanished. Anything the server
   * has since returned wins, so this list empties itself as the refresh
   * arrives rather than accumulating duplicates.
   */
  const [justCreated, setJustCreated] = useState<CollectionSummary[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function createCollection() {
    setError(null);
    const response = await fetch("/api/library/collections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "Couldn't create that collection.");
      return;
    }
    const created = (await response.json().catch(() => null)) as CollectionSummary | null;
    if (created) setJustCreated((prev) => [created, ...prev]);
    setName("");
    setCreating(false);
    router.refresh();
  }

  const shownCollections = [
    ...justCreated.filter((c) => !collections.some((server) => server.publicId === c.publicId)),
    ...collections,
  ];

  const tabs: Array<{ id: Tab; label: string; count: number }> = [
    { id: "papers", label: "Papers", count: papers.length },
    { id: "documents", label: "Documents", count: documents.length },
    { id: "collections", label: "Collections", count: shownCollections.length },
  ];

  return (
    <>
      <div role="tablist" aria-label="Library" className="border-line mb-4 flex gap-1 border-b">
        {tabs.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            onClick={() => setTab(entry.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
              tab === entry.id
                ? "border-accent text-ink"
                : "text-muted hover:text-ink border-transparent"
            }`}
          >
            {entry.label} <span className="metric text-muted">{entry.count}</span>
          </button>
        ))}
      </div>

      {tab === "papers" && <PaperList items={papers} />}
      {tab === "documents" && <DocumentList items={documents} />}

      {tab === "collections" && (
        <div className="space-y-3">
          {creating ? (
            <div className="border-line flex flex-wrap items-center gap-2 rounded-xl border p-3">
              <label htmlFor="collection-name" className="sr-only">
                Collection name
              </label>
              <input
                id="collection-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Thesis chapter 2"
                className="border-line bg-page text-ink min-w-0 flex-1 rounded-lg border px-3 py-1.5 text-sm outline-none"
              />
              <button
                type="button"
                disabled={!name.trim()}
                onClick={() => void createCollection()}
                className="bg-accent-solid text-accent-ink rounded-full px-3 py-1.5 text-sm font-medium disabled:opacity-50"
              >
                Create
              </button>
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="text-muted hover:text-ink text-sm"
              >
                Cancel
              </button>
              {error && (
                <p className="text-danger w-full text-xs" role="alert">
                  {error}
                </p>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="border-line text-muted hover:border-accent hover:text-accent rounded-full border px-3 py-1 text-xs font-medium transition-colors"
            >
              New collection
            </button>
          )}

          {shownCollections.length === 0 ? (
            <p className="text-muted text-sm">
              No collections yet. A collection can hold both saved papers and your own uploads.
            </p>
          ) : (
            <ul className="divide-line border-line divide-y rounded-xl border">
              {shownCollections.map((entry) => (
                <li key={entry.publicId}>
                  <Link
                    href={`/library/collections/${entry.publicId}`}
                    className="hover:bg-surface-2 block px-4 py-3 transition-colors"
                  >
                    <p className="text-ink text-sm font-medium">{entry.name}</p>
                    <p className="text-muted text-xs">
                      {entry.itemCount} item{entry.itemCount === 1 ? "" : "s"}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}

function PaperList({ items }: { items: SavedItem[] }) {
  if (items.length === 0) {
    return (
      <p className="text-muted text-sm">
        Nothing saved yet. Use <strong>Save</strong> on any search result.
      </p>
    );
  }
  return (
    <ul className="divide-line border-line divide-y rounded-xl border">
      {items.map((item) => {
        const work = item.workSnapshot;
        return (
          <li key={item.id} className="px-4 py-3">
            <a
              href={work?.landingPageUrl ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              className="text-link text-sm font-medium hover:underline"
            >
              {work?.title ?? item.workKey}
            </a>
            <p className="text-muted text-xs">
              {work?.authors
                .slice(0, 3)
                .map((a) => a.name)
                .join(", ")}
              {work?.year ? ` · ${work.year}` : ""}
              {work?.venue ? ` · ${work.venue}` : ""}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

function DocumentList({ items }: { items: SavedItem[] }) {
  if (items.length === 0) {
    return (
      <p className="text-muted text-sm">
        No uploads saved here yet. Upload a PDF in the{" "}
        <Link href="/reader" className="text-link hover:underline">
          Reader
        </Link>
        .
      </p>
    );
  }
  return (
    <ul className="divide-line border-line divide-y rounded-xl border">
      {items.map((item) => (
        <li key={item.id} className="px-4 py-3">
          {item.filename ? (
            <Link
              href={`/reader/${encodeURIComponent(item.documentId!)}`}
              className="text-link text-sm font-medium hover:underline"
            >
              {item.filename}
            </Link>
          ) : (
            // The upload was deleted but the saved item remains. Saying so
            // beats the row silently vanishing from the library.
            <p className="text-muted text-sm">This upload is no longer available.</p>
          )}
        </li>
      ))}
    </ul>
  );
}
