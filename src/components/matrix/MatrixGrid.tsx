"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export interface GridColumn {
  id: number;
  label: string;
  hint: string | null;
  valueType: string;
}

export interface GridRow {
  id: number;
  documentId: string;
  title: string;
}

export interface GridCell {
  rowId: number;
  columnId: number;
  value: string | null;
  unit: string | null;
  quote: string | null;
  pageNumber: number | null;
  status: "found" | "not_reported" | "error";
  error: string | null;
}

export interface DocumentOption {
  documentId: string;
  label: string;
}

export function MatrixGrid({
  publicId,
  columns,
  rows,
  cells,
  documents,
}: {
  publicId: string;
  columns: GridColumn[];
  rows: GridRow[];
  cells: GridCell[];
  documents: DocumentOption[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newColumn, setNewColumn] = useState("");
  const byPair = new Map(cells.map((c) => [`${c.rowId}:${c.columnId}`, c]));
  const unusedDocuments = documents.filter((d) => !rows.some((r) => r.documentId === d.documentId));

  async function post(path: string, body?: unknown) {
    const response = await fetch(path, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      const parsed = (await response.json().catch(() => null)) as { error?: string } | null;
      setNotice(parsed?.error ?? "That didn't work.");
      return null;
    }
    return response;
  }

  async function addColumn() {
    if (!newColumn.trim()) return;
    setBusy("column");
    if (await post(`/api/matrix/${publicId}/columns`, { label: newColumn.trim() })) {
      setNewColumn("");
      router.refresh();
    }
    setBusy(null);
  }

  async function addRow(documentId: string) {
    setBusy("row");
    if (await post(`/api/matrix/${publicId}/rows`, { documentId })) router.refresh();
    setBusy(null);
  }

  /**
   * Prices the run before starting it — #6's rule, and the reason a fill is two
   * requests rather than one. A 20x6 matrix is 120 provider calls; being told
   * afterwards is not being told.
   */
  async function fill(scope: string) {
    setBusy("fill");
    setNotice(null);
    try {
      const priced = await fetch(`/api/matrix/${publicId}/fill?${scope}`);
      const price = (await priced.json().catch(() => null)) as {
        cells?: number;
        estimate?: number;
        error?: string;
      } | null;
      if (!priced.ok || !price?.cells) {
        setNotice(price?.error ?? "Nothing left to fill.");
        return;
      }
      if (
        !window.confirm(
          `Fill ${price.cells} cell${price.cells === 1 ? "" : "s"}? This costs about ${price.estimate} credits.`,
        )
      ) {
        return;
      }

      const response = await post(`/api/matrix/${publicId}/fill?${scope}`);
      if (!response) return;
      const result = (await response.json()) as {
        filled: number;
        notReported: number;
        errors: number;
      };
      setNotice(
        `${result.filled} found, ${result.notReported} not reported${
          result.errors ? `, ${result.errors} failed` : ""
        }.`,
      );
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void fill("")}
          disabled={busy !== null || rows.length === 0 || columns.length === 0}
          className="bg-accent-solid text-accent-ink hover:bg-accent-solid-hover rounded-full px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50"
        >
          {busy === "fill" ? "Filling…" : "Fill empty cells"}
        </button>
        <a
          href={`/api/matrix/${publicId}/export`}
          className="border-line text-muted hover:border-accent hover:text-accent rounded-full border px-3 py-1 text-xs font-medium transition-colors"
        >
          Export CSV
        </a>
        {/* Same table, same quotes — one for a spreadsheet, one for a draft. */}
        <a
          href={`/api/matrix/${publicId}/export?format=md`}
          className="border-line text-muted hover:border-accent hover:text-accent rounded-full border px-3 py-1 text-xs font-medium transition-colors"
        >
          Export Markdown
        </a>
        {notice && (
          <span className="text-muted text-xs" role="status">
            {notice}
          </span>
        )}
      </div>

      <div className="border-line overflow-x-auto rounded-xl border">
        <table className="w-full min-w-max text-sm">
          <thead>
            <tr className="border-line bg-surface-2 border-b">
              <th className="text-muted px-3 py-2 text-left text-xs font-medium">Paper</th>
              {columns.map((column) => (
                <th key={column.id} className="px-3 py-2 text-left text-xs font-medium">
                  <span className="text-ink">{column.label}</span>
                  <button
                    type="button"
                    onClick={() => void fill(`columnId=${column.id}&force=1`)}
                    disabled={busy !== null}
                    title="Re-run just this field"
                    className="text-muted hover:text-accent ml-2 disabled:opacity-50"
                  >
                    ↻
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-line border-b last:border-b-0">
                <td className="text-ink max-w-[16rem] truncate px-3 py-2 text-xs">
                  <Link
                    href={`/reader/${encodeURIComponent(row.documentId)}`}
                    className="hover:underline"
                  >
                    {row.title}
                  </Link>
                </td>
                {columns.map((column) => (
                  <Cell
                    key={column.id}
                    cell={byPair.get(`${row.id}:${column.id}`)}
                    documentId={row.documentId}
                  />
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length + 1} className="text-muted px-3 py-4 text-sm">
                  No papers yet. Add one below.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-4">
        <div className="min-w-[16rem] flex-1">
          <label htmlFor="new-column" className="text-muted text-xs">
            Add a field
          </label>
          <div className="mt-1 flex gap-2">
            <input
              id="new-column"
              value={newColumn}
              onChange={(e) => setNewColumn(e.target.value)}
              placeholder="e.g. sample size"
              className="border-line bg-page text-ink min-w-0 flex-1 rounded-lg border px-3 py-1.5 text-sm outline-none"
            />
            <button
              type="button"
              onClick={() => void addColumn()}
              disabled={!newColumn.trim() || busy !== null}
              className="border-line text-muted hover:border-accent hover:text-accent rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50"
            >
              Add
            </button>
          </div>
        </div>

        <div className="min-w-[16rem] flex-1">
          <label htmlFor="add-row" className="text-muted text-xs">
            Add a paper
          </label>
          <select
            id="add-row"
            value=""
            disabled={busy !== null || unusedDocuments.length === 0}
            onChange={(e) => e.target.value && void addRow(e.target.value)}
            className="border-line bg-page text-ink mt-1 w-full rounded-lg border px-3 py-1.5 text-sm outline-none disabled:opacity-50"
          >
            <option value="">
              {unusedDocuments.length === 0 ? "Every upload is already here" : "Choose an upload…"}
            </option>
            {unusedDocuments.map((doc) => (
              <option key={doc.documentId} value={doc.documentId}>
                {doc.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p className="text-muted text-xs">
        A blank cell means the paper doesn&apos;t report that field. Hover a value to see the
        sentence it came from; click the page number to open it.
      </p>
    </div>
  );
}

/**
 * Three statuses, rendered distinctly, because the single most important
 * property of an evidence matrix is that "not reported" and "the extractor gave
 * up" look different. A value is never rendered without its provenance.
 */
function Cell({ cell, documentId }: { cell: GridCell | undefined; documentId: string }) {
  if (!cell) return <td className="text-muted px-3 py-2 text-xs">—</td>;

  if (cell.status === "error") {
    return (
      <td className="px-3 py-2 text-xs">
        <span className="text-danger" title={cell.error ?? undefined}>
          failed
        </span>
      </td>
    );
  }

  if (cell.status === "not_reported") {
    return <td className="text-muted px-3 py-2 text-xs italic">not reported</td>;
  }

  return (
    <td className="px-3 py-2 text-xs">
      <span className="text-ink" title={cell.quote ?? undefined}>
        {cell.value}
        {cell.unit ? ` ${cell.unit}` : ""}
      </span>
      {cell.pageNumber != null && (
        <Link
          href={`/reader/${encodeURIComponent(documentId)}?page=${cell.pageNumber}`}
          className="text-link ml-1 hover:underline"
        >
          p.{cell.pageNumber}
        </Link>
      )}
    </td>
  );
}
