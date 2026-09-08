"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { ChatPanel } from "@/components/search/ChatPanel";
import { RewritePanel } from "@/components/reader/RewritePanel";
import { DataPanel } from "@/components/reader/DataPanel";
import type { PdfPaneHandle } from "@/components/reader/PdfPane";

// pdf.js needs canvas, DOM measurement and a web worker, none of which exist
// during SSR. `ssr: false` is only honoured inside a Client Component, which
// is why this import lives here rather than in the page.
const PdfPane = dynamic(() => import("@/components/reader/PdfPane").then((m) => m.PdfPane), {
  ssr: false,
  loading: () => <p className="text-muted p-4 text-sm">Loading viewer…</p>,
});

type DocumentStatus = "parsed" | "indexing" | "indexed";

interface ReaderWorkspaceProps {
  documentId: string;
  filename: string;
  title: string | null;
  initialStatus: DocumentStatus;
  truncated: boolean;
  /** From `?page=` — set when arriving from a matrix cell or an export. */
  initialPage?: number;
}

const POLL_INTERVAL_MS = 2000;

export function ReaderWorkspace({
  documentId,
  filename,
  title,
  initialStatus,
  truncated,
  initialPage,
}: ReaderWorkspaceProps) {
  const [status, setStatus] = useState<DocumentStatus>(initialStatus);
  const [pane, setPane] = useState<PdfPaneHandle | null>(null);
  const [mobileTab, setMobileTab] = useState<"paper" | "chat">("paper");
  const [rightTab, setRightTab] = useState<"chat" | "data" | "rewrite">("chat");

  // retrieveChunks() would trigger indexing inline and block the first turn for
  // as long as embedding takes — a minute or more on the local backend. Polling
  // until it's warm keeps that cost visible instead of looking like a hang.
  useEffect(() => {
    if (status === "indexed") return;
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const response = await fetch(`/api/documents/${encodeURIComponent(documentId)}`);
        if (!response.ok) return;
        const body = (await response.json()) as { status: DocumentStatus };
        if (!cancelled) setStatus(body.status);
      } catch {
        // Transient — the next tick tries again.
      }
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [documentId, status]);

  /**
   * A `?page=` in the URL jumps there once the viewer reports ready.
   *
   * This is what makes a matrix cell's page link mean something: the cell says
   * "p. 7", and the whole point of provenance is that clicking it puts you in
   * front of page 7 rather than at the top of a 40-page PDF. Applied in the
   * onReady callback because scrollToPage does not exist until the pane has
   * measured itself.
   */
  const handleReady = useCallback(
    (handle: PdfPaneHandle) => {
      setPane(handle);
      if (initialPage) handle.scrollToPage(initialPage);
    },
    [initialPage],
  );

  const handleCitePage = useCallback(
    (page: number) => {
      setMobileTab("paper");
      pane?.scrollToPage(page);
    },
    [pane],
  );

  const heading = title ?? filename;

  const viewer = (
    <PdfPane
      fileUrl={`/api/documents/${encodeURIComponent(documentId)}/file`}
      onReady={handleReady}
    />
  );

  const chat = (
    <ChatPanel
      key={documentId}
      documentId={documentId}
      variant="embedded"
      onCitePage={handleCitePage}
      toggleLabel="Ask about this paper"
      placeholder="What sample size did they use?"
      emptyStateText="Ask anything about the full text — answers cite the page they came from."
      composerDisabledReason={
        status === "indexed" ? null : "Indexing this paper… chat opens as soon as it's ready."
      }
      notice={truncated ? "Only the first 500 pages were indexed." : null}
    />
  );

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col">
      <div className="border-line flex items-center justify-between gap-3 border-b px-4 py-2">
        <h1 className="text-ink truncate text-sm font-semibold">{heading}</h1>
        <span className="text-muted shrink-0 text-xs">
          {status === "indexed" ? "Ready" : "Indexing…"}
        </span>
      </div>

      {/* Below sm the split becomes tabs — two 50%-width panes on a phone is
          two unusable panes. */}
      <div className="border-line flex gap-1 border-b px-2 py-1 sm:hidden">
        {(["paper", "chat"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setMobileTab(tab)}
            aria-pressed={mobileTab === tab}
            className={`rounded-full px-3 py-1 text-xs capitalize transition-colors ${
              mobileTab === tab ? "bg-surface-2 text-ink" : "text-muted"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1">
        <div
          className={`min-h-0 flex-1 sm:block sm:basis-1/2 ${mobileTab === "paper" ? "" : "hidden"}`}
        >
          {viewer}
        </div>
        <div
          className={`border-line flex min-h-0 flex-1 flex-col sm:flex sm:basis-1/2 sm:border-l ${
            mobileTab === "chat" ? "" : "hidden"
          }`}
        >
          <div className="border-line flex gap-1 border-b px-2 py-1">
            {(
              [
                { id: "chat", label: "Chat" },
                { id: "data", label: "Data" },
                { id: "rewrite", label: "Rewrite" },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setRightTab(tab.id)}
                aria-pressed={rightTab === tab.id}
                className={`rounded-full px-3 py-1 text-xs transition-colors ${
                  rightTab === tab.id ? "bg-surface-2 text-ink" : "text-muted hover:text-ink"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {/* Both stay mounted: switching tabs must not discard a half-typed
              draft or an in-flight conversation. */}
          <div className={`min-h-0 flex-1 ${rightTab === "chat" ? "" : "hidden"}`}>{chat}</div>
          <div className={`min-h-0 flex-1 ${rightTab === "data" ? "" : "hidden"}`}>
            <DataPanel documentId={documentId} onCitePage={handleCitePage} />
          </div>
          <div className={`min-h-0 flex-1 ${rightTab === "rewrite" ? "" : "hidden"}`}>
            <RewritePanel />
          </div>
        </div>
      </div>
    </div>
  );
}
