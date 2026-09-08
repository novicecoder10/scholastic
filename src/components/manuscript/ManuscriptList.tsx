"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface ManuscriptSummary {
  publicId: string;
  title: string;
  updatedAt: string;
}

export function ManuscriptList({ manuscripts }: { manuscripts: ManuscriptSummary[] }) {
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function create() {
    setError(null);
    const response = await fetch("/api/manuscripts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    const body = (await response.json().catch(() => null)) as {
      error?: string;
      publicId?: string;
    } | null;
    if (!response.ok || !body?.publicId) {
      setError(body?.error ?? "Couldn't create that manuscript.");
      return;
    }
    router.push(`/write/${body.publicId}`);
  }

  return (
    <div className="space-y-4">
      {creating ? (
        <div className="border-line flex flex-wrap items-center gap-2 rounded-xl border p-3">
          <label htmlFor="manuscript-title" className="sr-only">
            Manuscript title
          </label>
          <input
            id="manuscript-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Mitochondrial dysfunction — related work"
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
          New manuscript
        </button>
      )}

      {manuscripts.length === 0 ? (
        <p className="text-muted text-sm">Nothing written yet.</p>
      ) : (
        <ul className="border-line divide-line divide-y rounded-xl border">
          {manuscripts.map((m) => (
            <li key={m.publicId}>
              <Link href={`/write/${m.publicId}`} className="hover:bg-surface-2 block px-4 py-3">
                <p className="text-ink text-sm font-medium">{m.title}</p>
                <p className="text-muted text-xs">
                  Edited {new Date(m.updatedAt).toLocaleDateString()}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
