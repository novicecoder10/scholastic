"use client";

import {
  Children,
  createElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import ReactMarkdown, { type Components } from "react-markdown";
import { CostHint } from "@/components/credits/CostHint";
import { splitPageCitations } from "@/lib/documents/pageCitations";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface SynthesisWork {
  workKey: string;
  title: string;
  abstract: string | null;
}

type ChatStatus = "idle" | "streaming" | "disabled" | "error" | "gone" | "no-credits";

interface ChatPanelProps {
  /** Single-paper context (title/abstract) — mutually exclusive with `works`. */
  context?: string;
  /** Multi-paper synthesis: the current result set (see /api/chat's doc comment). */
  works?: SynthesisWork[];
  toggleLabel?: string;
  placeholder?: string;
  emptyStateText?: string;
  /** Open on first render — used by the homepage's "Literature review" action. */
  defaultOpen?: boolean;
  /** Full-text chat over an uploaded PDF (#3) — mutually exclusive with both
   * `context` and `works`; /api/chat rejects any combination with a 400. */
  documentId?: string;
  /** Makes `[p. N]` citations interactive. Without it they render as the plain
   * text the model wrote, which is still correct — just not clickable. */
  onCitePage?: (page: number) => void;
  /** "disclosure" (default) is the collapsed toggle every existing call site
   * uses. "embedded" is an always-open pane that fills its container, which is
   * what the reader's split view needs. */
  variant?: "disclosure" | "embedded";
  /** Disables the composer with a reason shown in its place — the reader uses
   * this while a freshly uploaded document is still being indexed. */
  composerDisabledReason?: string | null;
  /** A quiet line under the header, e.g. degraded retrieval quality. */
  notice?: string | null;
}

/** Renders assistant text, turning `[p. N]` into buttons when the host can act
 * on them.
 *
 * Citations are substituted *inside* markdown's own output rather than by
 * splitting the string first. Splitting first is the obvious approach and it
 * is wrong: react-markdown renders block elements, so a citation lifted out of
 * the middle of a bullet list ends each run as its own list, and the answer
 * comes apart into one bullet per line (observed, not theorised). Overriding
 * the leaf components instead leaves document structure to markdown and only
 * rewrites text nodes.
 */
function AssistantContent({
  content,
  onCitePage,
}: {
  content: string;
  onCitePage?: (page: number) => void;
}) {
  const prose =
    "prose prose-sm dark:prose-invert prose-p:my-1.5 prose-ul:my-1.5 prose-ol:my-1.5 max-w-none";

  const components = useMemo(() => {
    if (!onCitePage) return undefined;
    const citePage = onCitePage;

    function decorate(children: ReactNode): ReactNode {
      return Children.map(children, (child) => {
        if (typeof child !== "string") return child;
        return splitPageCitations(child).map((segment, i) =>
          segment.type === "text" ? (
            segment.value
          ) : (
            <button
              key={i}
              type="button"
              onClick={() => citePage(segment.page)}
              title={`Go to page ${segment.page}`}
              className="border-accent/40 text-accent hover:bg-accent/10 mx-0.5 inline rounded-full border px-1.5 py-px align-baseline text-[11px] font-medium transition-colors"
            >
              p. {segment.page}
            </button>
          ),
        );
      });
    }

    // Every element that can hold a text leaf. Anything not listed still
    // renders — its citations just stay literal, the same graceful outcome as
    // omitting onCitePage entirely.
    const tags = ["p", "li", "td", "th", "strong", "em", "h1", "h2", "h3", "h4"] as const;
    return Object.fromEntries(
      tags.map((tag) => [
        tag,
        ({ children, ...props }: { children?: ReactNode }) =>
          createElement(tag, props, decorate(children)),
      ]),
    ) as Components;
  }, [onCitePage]);

  return (
    <div className={prose}>
      <ReactMarkdown components={components}>{content || "…"}</ReactMarkdown>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="text-muted hover:text-ink text-xs transition-colors"
    >
      {copied ? "Copied ✓" : "Copy"}
    </button>
  );
}

function TypingIndicator() {
  return (
    <div className="flex gap-1 px-4 py-3">
      <span className="bg-muted h-2 w-2 animate-bounce rounded-full [animation-delay:-0.3s] motion-reduce:animate-none" />
      <span className="bg-muted h-2 w-2 animate-bounce rounded-full [animation-delay:-0.15s] motion-reduce:animate-none" />
      <span className="bg-muted h-2 w-2 animate-bounce rounded-full motion-reduce:animate-none" />
    </div>
  );
}

/**
 * Self-contained disclosure: closed by default (a toggle button), opens into
 * a full chat interface. No persistence — the full message history is
 * round-tripped to /api/chat on every turn (see that route's doc comment for
 * why: accounts/saved state are explicitly out of scope for this milestone).
 * Reused for both single-paper ("Ask about this paper") and multi-paper
 * synthesis ("Synthesize across these results") — the streaming-consumption
 * logic is identical either way; only what's sent alongside `messages` differs.
 */
export function ChatPanel({
  context,
  works,
  toggleLabel = "Ask about this paper",
  placeholder = "Ask about this paper…",
  emptyStateText = "Ask a question and I'll answer based on this paper's abstract.",
  defaultOpen = false,
  documentId,
  onCitePage,
  variant = "disclosure",
  composerDisabledReason = null,
  notice = null,
}: ChatPanelProps) {
  const embedded = variant === "embedded";
  const [open, setOpen] = useState(defaultOpen || embedded);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<ChatStatus>("idle");
  const [creditMessage, setCreditMessage] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputId = useId();

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  function autoResize() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }

  async function sendMessage() {
    const trimmed = input.trim();
    if (!trimmed || status === "streaming") return;

    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: trimmed }];
    setMessages(nextMessages);
    setInput("");
    setStatus("streaming");
    requestAnimationFrame(autoResize);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          documentId
            ? { messages: nextMessages, documentId }
            : works
              ? { messages: nextMessages, works }
              : { messages: nextMessages, context },
        ),
      });

      if (response.status === 503) {
        setStatus("disabled");
        return;
      }
      if (response.status === 404) {
        setStatus("gone");
        return;
      }
      if (response.status === 403) {
        // The server's own sentence, not a generic one: it names the estimate,
        // the balance, and what stays free — all of which this component would
        // otherwise have to reconstruct and could get wrong.
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setCreditMessage(body?.error ?? "Not enough credits for this.");
        setStatus("no-credits");
        return;
      }
      if (!response.ok || !response.body) {
        setStatus("error");
        return;
      }

      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          updated[updated.length - 1] = { ...last, content: last.content + chunk };
          return updated;
        });
      }
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  function handleClear() {
    setMessages([]);
    setInput("");
    setStatus("idle");
  }

  if (!open && !embedded) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="border-line text-muted hover:border-accent hover:text-accent mt-3 rounded-full border px-3 py-1 text-xs font-medium transition-colors"
      >
        {toggleLabel}
      </button>
    );
  }

  const isStreamingWithNoContentYet =
    status === "streaming" && messages.length > 0 && messages[messages.length - 1].content === "";

  return (
    <div
      className={
        embedded
          ? "bg-surface flex h-full min-h-0 flex-col overflow-hidden"
          : "border-line bg-surface mt-3 flex h-[520px] flex-col overflow-hidden rounded-xl border"
      }
    >
      <div className="border-line flex items-center justify-between border-b px-4 py-2">
        <div className="min-w-0">
          <p className="text-ink truncate text-sm font-semibold">{toggleLabel}</p>
          {notice && <p className="text-muted text-[11px]">{notice}</p>}
        </div>
        <div className="flex items-center gap-3">
          {messages.length > 0 && (
            <button
              type="button"
              onClick={handleClear}
              className="text-muted hover:text-ink text-xs transition-colors"
            >
              Clear
            </button>
          )}
          {!embedded && (
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close chat"
              className="text-muted hover:text-ink transition-colors"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {messages.length === 0 && <p className="text-muted text-sm">{emptyStateText}</p>}

        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm ${
                m.role === "user"
                  ? "bg-accent-solid text-accent-ink"
                  : "border-line bg-surface-2 text-ink border"
              }`}
            >
              {m.role === "assistant" ? (
                <AssistantContent content={m.content} onCitePage={onCitePage} />
              ) : (
                <p className="whitespace-pre-wrap">{m.content}</p>
              )}
              {m.role === "assistant" &&
                m.content &&
                !(status === "streaming" && i === messages.length - 1) && (
                  <div className="mt-1 flex justify-end">
                    <CopyButton text={m.content} />
                  </div>
                )}
            </div>
          </div>
        ))}

        {isStreamingWithNoContentYet && (
          <div className="flex justify-start">
            <div className="border-line bg-surface-2 rounded-2xl border">
              <TypingIndicator />
            </div>
          </div>
        )}

        {status === "disabled" && (
          <p className="text-muted text-xs">Chat isn&apos;t configured on this instance.</p>
        )}
        {status === "gone" && (
          <p className="text-danger text-xs">
            This document is no longer available — it may have been deleted.
          </p>
        )}
        {status === "no-credits" && creditMessage && (
          <p className="text-ink text-xs" role="status">
            {creditMessage}{" "}
            <Link href="/credits" className="text-link hover:underline">
              See your credits
            </Link>
            .
          </p>
        )}
        {status === "error" && (
          <p className="text-danger text-xs">Something went wrong — try again.</p>
        )}
      </div>

      <div className="border-line border-t p-2">
        {composerDisabledReason ? (
          <p className="text-muted px-2 py-2 text-sm" aria-live="polite">
            {composerDisabledReason}
          </p>
        ) : (
          <>
            <div className="flex items-end gap-2">
              <label htmlFor={inputId} className="sr-only">
                {placeholder}
              </label>
              <textarea
                id={inputId}
                ref={textareaRef}
                rows={1}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  autoResize();
                }}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                disabled={status === "streaming"}
                className="border-line bg-page text-ink placeholder:text-muted focus-visible:border-accent max-h-40 flex-1 resize-none rounded-xl border px-3 py-2 text-sm outline-none disabled:opacity-60"
              />
              <button
                type="button"
                onClick={() => void sendMessage()}
                disabled={status === "streaming" || !input.trim()}
                className="bg-accent-solid text-accent-ink hover:bg-accent-solid-hover rounded-full px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              >
                {status === "streaming" ? "…" : "Send"}
              </button>
            </div>
            <p className="text-muted mt-1 px-1 text-[11px]">
              Enter to send · Shift+Enter for a new line ·{" "}
              <CostHint
                feature={documentId ? "document_chat_turn" : works ? "synthesis_turn" : "chat_turn"}
              />
            </p>
          </>
        )}
      </div>
    </div>
  );
}
