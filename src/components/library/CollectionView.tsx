"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CanonicalWork } from "@/lib/types/work";

interface Item {
  id: number;
  itemType: "work" | "document";
  documentId: string | null;
  workSnapshot: CanonicalWork | null;
  filename: string | null;
}

export function CollectionView({
  publicId,
  name,
  initialItems,
}: {
  publicId: string;
  name: string;
  initialItems: Item[];
}) {
  const [items, setItems] = useState(initialItems);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  /**
   * Reordering is optimistic: the list moves immediately and the request
   * follows. On failure the server order is restored by a refresh rather than
   * leaving the user looking at an order that isn't saved.
   */
  async function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= items.length || busy) return;

    const previous = items;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    setItems(next);
    setBusy(true);

    const response = await fetch(`/api/library/collections/${encodeURIComponent(publicId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order: next.map((i) => i.id) }),
    });
    setBusy(false);
    if (!response.ok) {
      setItems(previous);
      router.refresh();
    }
  }

  async function remove(savedItemId: number) {
    const response = await fetch(
      `/api/library/collections/${encodeURIComponent(publicId)}/items?savedItemId=${savedItemId}`,
      { method: "DELETE" },
    );
    if (response.ok) setItems((prev) => prev.filter((i) => i.id !== savedItemId));
  }

  const exportBase = `/api/library/collections/${encodeURIComponent(publicId)}/export`;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <a
          href={`${exportBase}?format=bibtex`}
          className="border-line text-muted hover:border-accent hover:text-accent rounded-full border px-3 py-1 text-xs font-medium transition-colors"
        >
          Export BibTeX
        </a>
        <a
          href={`${exportBase}?format=ris`}
          className="border-line text-muted hover:border-accent hover:text-accent rounded-full border px-3 py-1 text-xs font-medium transition-colors"
        >
          Export RIS
        </a>
      </div>

      {items.length === 0 ? (
        <p className="text-muted text-sm">
          Nothing in {name} yet. Save a paper from search, then add it here.
        </p>
      ) : (
        <ol className="divide-line border-line divide-y rounded-xl border">
          {items.map((item, index) => (
            <li key={item.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                {item.itemType === "work" ? (
                  <>
                    <a
                      href={item.workSnapshot?.landingPageUrl ?? undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-link text-sm font-medium hover:underline"
                    >
                      {item.workSnapshot?.title ?? "Untitled"}
                    </a>
                    <p className="text-muted truncate text-xs">
                      {item.workSnapshot?.authors
                        .slice(0, 3)
                        .map((a) => a.name)
                        .join(", ")}
                      {item.workSnapshot?.year ? ` · ${item.workSnapshot.year}` : ""}
                    </p>
                  </>
                ) : item.filename ? (
                  <Link
                    href={`/reader/${encodeURIComponent(item.documentId!)}`}
                    className="text-link text-sm font-medium hover:underline"
                  >
                    {item.filename}
                  </Link>
                ) : (
                  <p className="text-muted text-sm">This upload is no longer available.</p>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => void move(index, -1)}
                  disabled={index === 0 || busy}
                  aria-label="Move up"
                  className="text-muted hover:text-ink px-1 text-xs disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => void move(index, 1)}
                  disabled={index === items.length - 1 || busy}
                  aria-label="Move down"
                  className="text-muted hover:text-ink px-1 text-xs disabled:opacity-30"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => void remove(item.id)}
                  className="text-muted hover:text-danger ml-2 text-xs transition-colors"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
