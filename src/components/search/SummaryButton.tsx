"use client";

import { useState } from "react";
import { CostHint } from "@/components/credits/CostHint";
import ReactMarkdown from "react-markdown";

type SummaryState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; summary: string }
  | { status: "disabled" }
  | { status: "error"; message: string };

function SummaryShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-accent/25 bg-surface-2 mt-3 rounded-xl border p-3">
      <p className="text-accent mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide uppercase">
        <span aria-hidden="true">✦</span> AI summary
      </p>
      {children}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <SummaryShell>
      <div className="animate-pulse space-y-1.5 motion-reduce:animate-none">
        <div className="bg-accent/20 h-3 w-11/12 rounded-full" />
        <div className="bg-accent/20 h-3 w-4/5 rounded-full" />
        <div className="bg-accent/20 h-3 w-3/5 rounded-full" />
      </div>
    </SummaryShell>
  );
}

export function SummaryButton({ workKey }: { workKey: string }) {
  const [state, setState] = useState<SummaryState>({ status: "idle" });

  async function handleClick() {
    setState({ status: "loading" });
    try {
      const response = await fetch(`/api/works/${encodeURIComponent(workKey)}/summary`, {
        method: "POST",
      });
      if (response.status === 503) {
        setState({ status: "disabled" });
        return;
      }
      if (response.status === 403) {
        // The server names the estimate, the balance, and what stays free.
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setState({
          status: "error",
          message: body?.error ?? "Not enough credits for a summary.",
        });
        return;
      }
      if (!response.ok) {
        setState({ status: "error", message: "Couldn't generate a summary right now." });
        return;
      }
      const body = (await response.json()) as { summary: string };
      setState({ status: "success", summary: body.summary });
    } catch {
      setState({ status: "error", message: "Couldn't generate a summary right now." });
    }
  }

  if (state.status === "success") {
    return (
      <SummaryShell>
        <div className="prose prose-sm dark:prose-invert prose-p:my-1 text-ink max-w-none">
          <ReactMarkdown>{state.summary}</ReactMarkdown>
        </div>
      </SummaryShell>
    );
  }

  if (state.status === "loading") {
    return <LoadingSkeleton />;
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={handleClick}
        className="border-accent/30 text-accent hover:bg-surface-2 rounded-full border px-3 py-1 text-xs font-medium transition-colors"
      >
        ✦ Summarize with AI
      </button>
      <CostHint feature="summary" className="ml-2" />
      {state.status === "disabled" && (
        <p className="text-muted mt-1 text-xs">
          AI summaries aren&apos;t configured on this instance.
        </p>
      )}
      {state.status === "error" && <p className="text-danger mt-1 text-xs">{state.message}</p>}
    </div>
  );
}
