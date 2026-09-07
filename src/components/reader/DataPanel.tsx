"use client";

import { useEffect, useState } from "react";
import { CostHint } from "@/components/credits/CostHint";

interface TableRecord {
  id: number;
  pageNumber: number;
  caption: string | null;
  grid: string[][];
  headerRow: number | null;
  units: Array<string | null> | null;
  confidence: number;
  description: string | null;
}

interface FindingRecord {
  id: number;
  pageNumber: number;
  field: string;
  value: string;
  unit: string | null;
  quote: string;
}

/** Below this the geometry is telling you it is unsure, and the reader is told
 * too. Surfacing a low-confidence table is right; presenting it as equal to a
 * clean one is not. */
const LOW_CONFIDENCE = 0.7;

export function DataPanel({
  documentId,
  onCitePage,
}: {
  documentId: string;
  onCitePage?: (page: number) => void;
}) {
  const [tables, setTables] = useState<TableRecord[]>([]);
  const [findings, setFindings] = useState<FindingRecord[]>([]);
  const [state, setState] = useState<"loading" | "idle" | "running" | "error">("loading");
  const [ran, setRan] = useState(false);

  // Loads whatever was extracted previously. The request is aborted on unmount
  // rather than left to resolve into a component that is gone.
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/documents/${encodeURIComponent(documentId)}/extract`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return (await response.json()) as { tables: TableRecord[]; findings: FindingRecord[] };
      })
      .then((body) => {
        setTables(body.tables);
        setFindings(body.findings);
        setState("idle");
      })
      .catch((err) => {
        if (controller.signal.aborted || (err as Error).name === "AbortError") return;
        setState("error");
      });
    return () => controller.abort();
  }, [documentId]);

  async function extract() {
    setState("running");
    try {
      const response = await fetch(`/api/documents/${encodeURIComponent(documentId)}/extract`, {
        method: "POST",
      });
      if (!response.ok) return setState("error");
      const body = (await response.json()) as { tables: TableRecord[]; findings: FindingRecord[] };
      setTables(body.tables);
      setFindings(body.findings);
      setRan(true);
      setState("idle");
    } catch {
      setState("error");
    }
  }

  const empty = tables.length === 0 && findings.length === 0;

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void extract()}
          disabled={state === "running"}
          className="bg-accent-solid text-accent-ink hover:bg-accent-solid-hover rounded-full px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50"
        >
          {state === "running" ? "Reading the paper…" : empty ? "Extract data" : "Re-extract"}
        </button>
        {/* Table geometry is free; only the labelling and the prose statistics
            cost anything, so the hint names the metered half. */}
        <CostHint feature="findings" />
      </div>

      {state === "error" && (
        <p className="text-danger text-sm" role="alert">
          Couldn&apos;t extract data from this document.
        </p>
      )}

      {state === "loading" && <p className="text-muted text-sm">Loading…</p>}

      {state !== "loading" && empty && (
        <p className="text-muted text-sm">
          {ran
            ? "No tables or reported statistics were found in this PDF. Scanned pages and image-only tables have no text layer to read."
            : "Pull the tables and reported statistics out of this paper. Tables are found geometrically and cost nothing; the statistics need a model."}
        </p>
      )}

      {tables.length > 0 && (
        <section className="mb-6">
          <h3 className="text-ink mb-2 text-sm font-semibold">Tables</h3>
          <div className="space-y-4">
            {tables.map((table) => (
              <TableCard key={table.id} table={table} onCitePage={onCitePage} />
            ))}
          </div>
        </section>
      )}

      {findings.length > 0 && (
        <section>
          <h3 className="text-ink mb-2 text-sm font-semibold">Reported statistics</h3>
          <ul className="border-line divide-line divide-y rounded-xl border">
            {findings.map((finding) => (
              <li key={finding.id} className="px-3 py-2 text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-muted text-xs">{finding.field.replace(/_/g, " ")}</span>
                  <button
                    type="button"
                    onClick={() => onCitePage?.(finding.pageNumber)}
                    className="text-link text-xs hover:underline"
                  >
                    p. {finding.pageNumber}
                  </button>
                </div>
                <p className="text-ink">
                  {finding.value}
                  {finding.unit ? ` ${finding.unit}` : ""}
                </p>
                {/* The quote is not decoration. A number without the sentence it
                    came from is unverifiable, which is the failure mode this
                    whole feature is built to avoid. */}
                <p className="text-muted mt-1 text-xs italic">“{finding.quote}”</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function TableCard({
  table,
  onCitePage,
}: {
  table: TableRecord;
  onCitePage?: (page: number) => void;
}) {
  return (
    <div className="border-line rounded-xl border">
      <div className="border-line flex flex-wrap items-baseline justify-between gap-2 border-b px-3 py-2">
        <span className="text-ink text-xs font-medium">
          {table.caption ?? table.description ?? "Table"}
        </span>
        <span className="flex items-center gap-2">
          {table.confidence < LOW_CONFIDENCE && (
            <span
              className="text-muted text-[11px]"
              title="The column boundaries in this region were irregular — check it against the page."
            >
              low confidence
            </span>
          )}
          <button
            type="button"
            onClick={() => onCitePage?.(table.pageNumber)}
            className="text-link text-xs hover:underline"
          >
            p. {table.pageNumber}
          </button>
        </span>
      </div>
      {/* Wide grids scroll inside the card rather than widening the pane. */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <tbody>
            {table.grid.map((row, rowIndex) => (
              <tr key={rowIndex} className={rowIndex === table.headerRow ? "bg-surface-2" : ""}>
                {row.map((cell, cellIndex) => (
                  <td
                    key={cellIndex}
                    className={`border-line border-t px-2 py-1 ${
                      rowIndex === table.headerRow ? "text-ink font-medium" : "text-ink/80"
                    }`}
                  >
                    {cell}
                    {rowIndex === table.headerRow && table.units?.[cellIndex] ? (
                      <span className="text-muted"> ({table.units[cellIndex]})</span>
                    ) : null}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
