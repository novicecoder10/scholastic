"use client";

import { useState } from "react";
import type { CanonicalWork } from "@/lib/types/work";

type State = "idle" | "saving" | "saved" | "signed-out" | "unavailable" | "error";

/**
 * Save sits beside Cite on every result card. It is rendered for everyone,
 * signed in or not: a control that appears only once you have an account can't
 * tell you the account exists. Clicking it signed out explains what to do
 * rather than failing.
 */
export function SaveButton({
  work,
  initiallySaved = false,
}: {
  work: CanonicalWork;
  initiallySaved?: boolean;
}) {
  const [state, setState] = useState<State>(initiallySaved ? "saved" : "idle");

  async function toggle() {
    if (state === "saving") return;

    if (state === "saved") {
      setState("saving");
      const response = await fetch(
        `/api/library/items?workKey=${encodeURIComponent(work.workKey)}`,
        { method: "DELETE" },
      );
      setState(response.ok || response.status === 404 ? "idle" : "error");
      return;
    }

    setState("saving");
    try {
      const response = await fetch("/api/library/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemType: "work", work }),
      });
      if (response.status === 401) return setState("signed-out");
      if (response.status === 503) return setState("unavailable");
      setState(response.ok ? "saved" : "error");
    } catch {
      setState("error");
    }
  }

  const label = state === "saving" ? "…" : state === "saved" ? "Saved ✓" : "Save";

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={() => void toggle()}
        aria-pressed={state === "saved"}
        className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
          state === "saved"
            ? "border-accent text-accent"
            : "border-line text-muted hover:border-accent hover:text-accent"
        }`}
      >
        {label}
      </button>
      {state === "signed-out" && (
        <a href="/login" className="text-link text-xs hover:underline">
          Sign in to save
        </a>
      )}
      {state === "unavailable" && (
        <span className="text-muted text-xs">Accounts aren&apos;t enabled here.</span>
      )}
      {state === "error" && <span className="text-danger text-xs">Couldn&apos;t save.</span>}
    </span>
  );
}
