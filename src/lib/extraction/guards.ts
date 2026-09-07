/**
 * The non-invention guards.
 *
 * Both are mechanical, so "the model never invents a number" is a property of
 * the code rather than a hope about a prompt. Everything else in #7 depends on
 * these holding: an evidence matrix that can fabricate a value is not a slower
 * research tool, it is a research-integrity failure.
 */

export interface TableInterpretation {
  /** Index into the grid, or null when the table has no header row. */
  headerRow: number | null;
  /** One entry per column; null where no unit applies. */
  units: Array<string | null>;
  description: string;
}

function normalise(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Interpretation may **relabel, never re-value**.
 *
 * The model is asked which row is the header, what unit each column is in, and
 * for a one-line description — never for cell values. This checks that promise
 * rather than trusting it: any unit string that does not appear somewhere in
 * the grid is a value the model supplied from outside the table, and the whole
 * interpretation is discarded so the raw grid stands unlabelled.
 *
 * Discarding all of it, rather than the offending field, is deliberate: a
 * response that invented one unit has demonstrated it is not doing the task,
 * and a partially-trusted interpretation is harder to reason about than none.
 */
export function validateInterpretation(
  grid: string[][],
  candidate: unknown,
): TableInterpretation | null {
  if (typeof candidate !== "object" || candidate === null) return null;
  const raw = candidate as Record<string, unknown>;

  const columns = grid[0]?.length ?? 0;
  if (columns === 0) return null;

  const headerRow =
    typeof raw.headerRow === "number" && Number.isInteger(raw.headerRow) ? raw.headerRow : null;
  if (headerRow !== null && (headerRow < 0 || headerRow >= grid.length)) return null;

  if (!Array.isArray(raw.units)) return null;
  if (raw.units.length !== columns) return null;

  const cells = new Set(grid.flat().map(normalise));
  const units: Array<string | null> = [];
  for (const unit of raw.units) {
    if (unit === null || unit === undefined || unit === "") {
      units.push(null);
      continue;
    }
    if (typeof unit !== "string") return null;
    // A unit is only legitimate if it was written in the table. "mg/dL" pulled
    // from the model's expectations of what such a table usually contains is
    // exactly the invention this guard exists to catch.
    if (!containsToken(cells, unit)) return null;
    units.push(unit);
  }

  const description = typeof raw.description === "string" ? raw.description.trim() : "";
  if (description === "") return null;

  return { headerRow, units, description };
}

/** A unit rarely occupies a whole cell — "Mean (mg/dL)" holds it as a
 * fragment — so a substring match against any cell is the honest test. */
function containsToken(cells: Set<string>, token: string): boolean {
  const needle = normalise(token);
  if (cells.has(needle)) return true;
  for (const cell of cells) if (cell.includes(needle)) return true;
  return false;
}

export interface QuotedValue {
  value: string;
  quote: string;
}

/**
 * Whitespace differs constantly between a PDF's text layer and anything a model
 * echoes back — line breaks become spaces, double spaces collapse. Comparing
 * raw strings would reject almost every honest quote, so both sides are
 * normalised before the substring test. Nothing else is relaxed: the words
 * themselves must match.
 */
export function quoteAppearsIn(source: string, quote: string): boolean {
  if (quote.trim() === "") return false;
  return normalise(source).includes(normalise(quote));
}

/**
 * Drops any finding whose quote is not present in the text it was supposedly
 * extracted from, and any whose value is not present in its own quote.
 *
 * The second check is the one people forget. A quote can be perfectly genuine
 * while the value beside it was inferred — "we recruited participants across
 * three sites" quoted against a sample size of 412 — and that reads as
 * provenanced when it is not.
 */
export function keepQuotedFindings<T extends QuotedValue>(source: string, findings: T[]): T[] {
  return findings.filter(
    (finding) =>
      quoteAppearsIn(source, finding.quote) && quoteAppearsIn(finding.quote, finding.value),
  );
}
