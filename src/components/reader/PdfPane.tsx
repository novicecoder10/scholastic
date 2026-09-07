"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";

// Same-origin worker, copied into public/ at postinstall by
// scripts/copy-pdf-worker.mjs. Not a CDN URL: this page renders documents the
// user uploaded, and it should keep working with no network.
pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

/** How many pages either side of the visible one keep a live canvas. #2 caps
 * uploads at 500 pages, and 500 mounted canvases is an out-of-memory tab. */
const RENDER_WINDOW = 2;

export interface PdfPaneHandle {
  scrollToPage: (page: number) => void;
}

interface PdfPaneProps {
  fileUrl: string;
  /** Called on mount with the imperative handle the workspace uses to answer
   * `[p. N]` clicks. A ref callback rather than forwardRef so the workspace can
   * hold it in ordinary state and re-render when it arrives. */
  onReady?: (handle: PdfPaneHandle) => void;
}

export function PdfPane({ fileUrl, onReady }: PdfPaneProps) {
  const [pageCount, setPageCount] = useState(0);
  const [failed, setFailed] = useState(false);
  const [visiblePage, setVisiblePage] = useState(1);
  const [width, setWidth] = useState<number | undefined>(undefined);

  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef(new Map<number, HTMLDivElement>());

  const scrollToPage = useCallback((page: number) => {
    pageRefs.current.get(page)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setVisiblePage(page);
  }, []);

  useEffect(() => {
    onReady?.({ scrollToPage });
  }, [onReady, scrollToPage]);

  // Pages are sized to the pane, not the window: the reader is a split view, so
  // the pane is roughly half the viewport on desktop and all of it on mobile.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.max(240, Math.floor(entry.contentRect.width - 32)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Which page is "current" drives both the page counter and the render
  // window, so it is tracked by intersection rather than by scroll maths.
  useEffect(() => {
    if (pageCount === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (top) setVisiblePage(Number(top.target.getAttribute("data-page")));
      },
      { root: scrollRef.current, threshold: [0.1, 0.5] },
    );
    for (const el of pageRefs.current.values()) observer.observe(el);
    return () => observer.disconnect();
  }, [pageCount]);

  if (failed) {
    return (
      <div className="text-muted flex h-full items-center justify-center p-6 text-sm">
        <p>
          This PDF couldn&apos;t be displayed. Chat still works — the text was extracted at upload.
        </p>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col">
      <div ref={scrollRef} className="bg-surface-2 flex-1 overflow-y-auto p-4">
        <Document
          file={fileUrl}
          onLoadSuccess={({ numPages }) => setPageCount(numPages)}
          onLoadError={() => setFailed(true)}
          loading={<p className="text-muted p-4 text-sm">Loading document…</p>}
          error={null}
        >
          {Array.from({ length: pageCount }, (_, i) => i + 1).map((page) => (
            <div
              key={page}
              data-page={page}
              ref={(el) => {
                if (el) pageRefs.current.set(page, el);
                else pageRefs.current.delete(page);
              }}
              className="mx-auto mb-4 w-fit"
            >
              {Math.abs(page - visiblePage) <= RENDER_WINDOW ? (
                <Page pageNumber={page} width={width} className="shadow-lg" />
              ) : (
                // A placeholder of roughly page proportions, so scroll
                // position stays stable as pages enter and leave the window.
                <div
                  aria-hidden="true"
                  className="border-line bg-surface border"
                  style={{ width, height: width ? width * 1.294 : 800 }}
                />
              )}
            </div>
          ))}
        </Document>
      </div>

      {pageCount > 0 && (
        <p className="border-line text-muted border-t px-3 py-1.5 text-xs" aria-live="polite">
          Page {visiblePage} of {pageCount}
        </p>
      )}
    </div>
  );
}
