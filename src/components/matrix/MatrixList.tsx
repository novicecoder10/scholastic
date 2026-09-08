"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface MatrixSummary {
  publicId: string;
  title: string;
  updatedAt: string;
  rowCount: number;
  columnCount: number;
}

export function MatrixList({ matrices }: { matrices: MatrixSummary[] }) {
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function create() {
    setError(null);
    const response = await fetch("/api/matrix", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    const body = (await response.json().catch(() => null)) as {
      error?: string;
      publicId?: string;
    } | null;
    if (!response.ok || !body?.publicId) {
      setError(body?.error ?? "Couldn't create that matrix.");
      return;
    }
    // Straight into the new matrix: an empty grid in a list is not the thing
    // anyone wanted, the grid is.
    router.push(`/matrix/${body.publicId}`);
  }

  return (
    <div className="space-y-4">
      {creating ? (
        <div className="border-line flex flex-wrap items-center gap-2 rounded-xl border p-3">
          <label htmlFor="matrix-title" className="sr-only">
            Matrix title
          </label>
          <input
            id="matrix-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Sleep and memory consolidation"
            className="border-line bg-page text-ink min-w-0 flex-1 rounded-lg border px-3 py-1.5 text-sm outline-none"
          />
          <button
            type="button"
            disabled={!title.trim()}
            onClick={() => void create()}
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
          New matrix
        </button>
      )}

      {matrices.length === 0 ? (
        <p className="text-muted text-sm">
          No matrices yet. One is worth making when you have several papers and the same handful of
          questions about each.
        </p>
      ) : (
        <ul className="border-line divide-line divide-y rounded-xl border">
          {matrices.map((m) => (
            <li key={m.publicId}>
              <Link href={`/matrix/${m.publicId}`} className="hover:bg-surface-2 block px-4 py-3">
                <p className="text-ink text-sm font-medium">{m.title}</p>
                <p className="text-muted text-xs">
                  <span className="metric">{m.rowCount}</span> papers ·{" "}
                  <span className="metric">{m.columnCount}</span> fields
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
