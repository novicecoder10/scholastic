"use client";

import { useState } from "react";
import { CostHint } from "@/components/credits/CostHint";
import {
  countWords,
  MAX_PARAPHRASE_WORDS,
  PARAPHRASE_MODES,
  type ParaphraseMode,
} from "@/lib/ai/paraphrase";

type Status = "idle" | "streaming" | "disabled" | "error";

/**
 * Rewrites text the user pastes in — their own draft, not the paper on the
 * left. The two are different verbs and the panel says which one this is: the
 * paper's own prose is handled by "explain this passage" in chat.
 */
export function RewritePanel() {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<ParaphraseMode>("plain-language");
  const [result, setResult] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  const words = countWords(text);
  const overLimit = words > MAX_PARAPHRASE_WORDS;

  async function rewrite() {
    if (!text.trim() || overLimit || status === "streaming") return;
    setStatus("streaming");
    setResult("");
    setError(null);
    try {
      const response = await fetch("/api/paraphrase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, mode }),
      });
      if (response.status === 503) {
        setStatus("disabled");
        return;
      }
      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Couldn't rewrite that — try again.");
        setStatus("error");
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        setResult((prev) => prev + decoder.decode(value, { stream: true }));
      }
      setStatus("idle");
    } catch {
      setError("Couldn't rewrite that — try again.");
      setStatus("error");
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-4">
      <h2 className="text-ink text-sm font-semibold">Rewrite your own text</h2>
      <p className="text-muted mt-1 text-xs">
        Paste a paragraph you wrote. Citations, hedging and claims are preserved — to understand the
        paper on the left instead, ask about it in Chat.
      </p>

      <div className="mt-3 flex flex-wrap gap-1">
        {PARAPHRASE_MODES.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => setMode(option.id)}
            title={option.hint}
            aria-pressed={mode === option.id}
            className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
              mode === option.id ? "bg-surface-2 text-ink" : "text-muted hover:text-ink"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <label htmlFor="rewrite-input" className="sr-only">
        Text to rewrite
      </label>
      <textarea
        id="rewrite-input"
        rows={8}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Paste your draft paragraph…"
        className="border-line bg-page text-ink placeholder:text-muted focus-visible:border-accent mt-2 w-full resize-y rounded-xl border px-3 py-2 text-sm outline-none"
      />

      <div className="mt-1 flex items-center justify-between">
        <span className={`text-[11px] ${overLimit ? "text-danger" : "text-muted"}`}>
          {words} / {MAX_PARAPHRASE_WORDS} words · <CostHint feature="paraphrase" />
        </span>
        <button
          type="button"
          onClick={() => void rewrite()}
          disabled={!text.trim() || overLimit || status === "streaming"}
          className="bg-accent-solid text-accent-ink hover:bg-accent-solid-hover rounded-full px-4 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === "streaming" ? "Rewriting…" : "Rewrite"}
        </button>
      </div>

      {status === "disabled" && (
        <p className="text-muted mt-3 text-xs">Rewriting isn&apos;t configured on this instance.</p>
      )}
      {error && (
        <p className="text-danger mt-3 text-xs" role="alert">
          {error}
        </p>
      )}

      {result && (
        <div className="border-line bg-surface-2 mt-4 rounded-xl border p-3">
          <p className="text-ink text-sm whitespace-pre-wrap">{result}</p>
          <p className="text-muted mt-2 text-[11px]">
            Rewriting source material doesn&apos;t remove the need to cite it.
          </p>
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={() => void navigator.clipboard.writeText(result)}
              className="text-muted hover:text-ink text-xs transition-colors"
            >
              Copy
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
