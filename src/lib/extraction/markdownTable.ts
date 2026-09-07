/**
 * A matrix as Markdown, for pasting into a review draft.
 *
 * The CSV export is the archival one: every value, its page and its quote, in
 * columns a spreadsheet can sort. This is the other half of the same rule —
 * a comparison table that leaves its evidence behind stops being checkable the
 * moment it is pasted somewhere — so the quotes travel with the table rather
 * than being dropped to make it fit. They go underneath, because a quote in a
 * cell makes a table nothing can read.
 */

export interface MarkdownCell {
  /** The rendered value, or null when the paper does not report this field. */
  value: string | null;
  pageNumber: number | null;
  quote: string | null;
  /** found | not_reported | error */
  status: string;
}

export interface MarkdownRow {
  document: string;
  cells: MarkdownCell[];
}

/** A pipe inside a cell would end the column early, and a newline would end the
 * row. Escaping is the whole of the format's syntax. */
function escapeCell(text: string): string {
  return text
    .replace(/\|/g, "\\|")
    .replace(/\s*\n\s*/g, " ")
    .trim();
}

function renderValue(cell: MarkdownCell): string {
  if (cell.status === "not_reported") return "*not reported*";
  if (cell.status !== "found" || cell.value === null) return "—";
  const page = cell.pageNumber != null ? ` (p. ${cell.pageNumber})` : "";
  return `${escapeCell(cell.value)}${page}`;
}

export function renderMatrixMarkdown(
  title: string,
  columns: string[],
  rows: MarkdownRow[],
): string {
  const lines: string[] = [`# ${title}`, ""];

  const header = ["Paper", ...columns.map(escapeCell)];
  lines.push(`| ${header.join(" | ")} |`);
  lines.push(`| ${header.map(() => "---").join(" | ")} |`);
  for (const row of rows) {
    lines.push(`| ${[escapeCell(row.document), ...row.cells.map(renderValue)].join(" | ")} |`);
  }

  // "not reported" is a finding about the paper, not a gap in the extraction,
  // and it is the distinction a reader of a pasted table most needs spelled
  // out — an em dash on its own would be read as "we didn't check".
  lines.push("", "*Blank (—) means no value was extracted. *not reported* means the paper does");
  lines.push("not state it.*");

  const quoted = rows.flatMap((row) =>
    row.cells
      .map((cell, index) => ({ row, cell, column: columns[index] }))
      .filter((entry) => entry.cell.status === "found" && entry.cell.quote),
  );
  if (quoted.length > 0) {
    lines.push("", "## Evidence", "");
    for (const { row, cell, column } of quoted) {
      const page = cell.pageNumber != null ? `p. ${cell.pageNumber}` : "page unknown";
      lines.push(`- **${row.document} — ${column}** (${page}): “${cell.quote}”`);
    }
  }

  return `${lines.join("\n")}\n`;
}
