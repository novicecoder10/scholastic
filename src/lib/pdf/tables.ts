/**
 * Geometric table detection over positioned text items.
 *
 * Pure — no PDF library, no I/O — so every rule here is unit-testable against
 * recorded item arrays rather than against a parsed document.
 *
 * Tables are a **geometry** problem and prose statistics are a **semantics**
 * one. Flattening a page to text and asking a model for structure is exactly
 * how numbers end up in the wrong row: pdfjs emits items in draw order, not
 * reading order, so a two-column numeric table arrives interleaved. Nothing in
 * this file ever sees a model.
 */

export interface PositionedItem {
  text: string;
  /** Left edge, PDF user space (origin bottom-left). */
  x: number;
  /** Baseline y. Larger is higher on the page. */
  y: number;
  width: number;
  height: number;
}

export interface ExtractedTable {
  pageNumber: number;
  caption: string | null;
  /** Row-major. Unoccupied cells are "". */
  grid: string[][];
  /** 0..1, derived from the geometry — never a model's self-report. */
  confidence: number;
}

interface Line {
  y: number;
  items: PositionedItem[];
}

/** A run shorter than this is a coincidence of two aligned prose lines, not a
 * table. Three is the smallest run where consistent column boundaries mean
 * something. */
const MIN_TABLE_LINES = 3;

/** A gap counts as a column separator when it exceeds this multiple of the
 * line's median character width. Ordinary inter-word spacing sits well below
 * it; the gutter between columns sits well above. */
const COLUMN_GAP_RATIO = 2.2;

const CAPTION_RE = /^(?:Table|TABLE|Tab\.)\s*\d+/;

/** Items whose baselines differ by less than this fraction of their height are
 * the same line. Loose enough that a subscript joins its line rather than
 * starting one; tight enough that consecutive lines stay apart. */
const LINE_TOLERANCE_RATIO = 0.5;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Groups items into lines by baseline, then orders each line left to right —
 * which is where draw order stops mattering. */
export function groupIntoLines(items: PositionedItem[]): Line[] {
  const usable = items.filter((item) => item.text.trim() !== "");
  if (usable.length === 0) return [];

  const tolerance = Math.max(1, median(usable.map((i) => i.height)) * LINE_TOLERANCE_RATIO);
  const byY = [...usable].sort((a, b) => b.y - a.y);

  const lines: Line[] = [];
  for (const item of byY) {
    const current = lines[lines.length - 1];
    if (current && Math.abs(current.y - item.y) <= tolerance) {
      current.items.push(item);
    } else {
      lines.push({ y: item.y, items: [item] });
    }
  }
  for (const line of lines) line.items.sort((a, b) => a.x - b.x);
  return lines;
}

/** How many gaps in this line are wide enough to be column separators. */
function columnGapCount(line: Line): number {
  if (line.items.length < 2) return 0;
  const charWidth = median(
    line.items.map((i) => (i.text.length > 0 ? i.width / i.text.length : i.width)),
  );
  const threshold = Math.max(charWidth * COLUMN_GAP_RATIO, 1);

  let gaps = 0;
  for (let i = 1; i < line.items.length; i++) {
    const previous = line.items[i - 1];
    if (line.items[i].x - (previous.x + previous.width) > threshold) gaps += 1;
  }
  return gaps;
}

interface Region {
  lines: Line[];
  startIndex: number;
  endIndex: number;
}

/** Runs of consecutive lines that each split into at least two column groups. */
function findRegions(lines: Line[]): Region[] {
  const regions: Region[] = [];
  let run: Line[] = [];
  let runStart = 0;

  const flush = (endIndex: number) => {
    if (run.length >= MIN_TABLE_LINES) {
      regions.push({ lines: run, startIndex: runStart, endIndex });
    }
    run = [];
  };

  lines.forEach((line, index) => {
    if (columnGapCount(line) >= 1) {
      if (run.length === 0) runStart = index;
      run.push(line);
    } else {
      flush(index - 1);
    }
  });
  flush(lines.length - 1);
  return regions;
}

export interface ColumnBand {
  start: number;
  end: number;
}

/**
 * Columns are the **occupied bands** of the x axis: project every item's span
 * onto it, merge spans separated by less than a column gutter, and the gaps
 * that survive are the separators.
 *
 * This replaced clustering item start-x, which discarded the one piece of
 * information that distinguishes a gutter from a space: width. `O((log p)^3)`
 * reaches pdfjs as five items — a math run, a variable, a raised exponent — and
 * their start positions sit as far apart as two narrow columns', so every row
 * of the table grew a phantom cell and every value after the formula shifted
 * one column right. Their *spans* are touching, which is what being one cell
 * actually means.
 *
 * Alignment stops mattering here, which is why the left/right-aligned
 * tie-breaker this file used to carry is gone: a right-aligned numeric column
 * and a left-aligned label column are both just bands.
 */
export function columnBands(items: PositionedItem[], threshold: number): ColumnBand[] {
  if (items.length === 0) return [];

  const spans = items
    .map((i) => ({ start: i.x, end: i.x + i.width }))
    .sort((a, b) => a.start - b.start);

  const bands: ColumnBand[] = [{ ...spans[0] }];
  for (const span of spans.slice(1)) {
    const current = bands[bands.length - 1];
    if (span.start - current.end <= threshold) current.end = Math.max(current.end, span.end);
    else bands.push({ ...span });
  }
  return bands;
}

/** The band an item belongs to is the one it overlaps most — not the nearest
 * edge, so a right-aligned number and a left-aligned label in the same column
 * land in the same cell without the grid having to know which way the column is
 * aligned. */
function bandFor(item: PositionedItem, bands: ColumnBand[]): number {
  let best = 0;
  let bestOverlap = -Infinity;
  bands.forEach((band, index) => {
    const overlap = Math.min(item.x + item.width, band.end) - Math.max(item.x, band.start);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = index;
    }
  });
  return best;
}

function buildGrid(region: Region): { grid: string[][]; bands: ColumnBand[] } {
  const items = region.lines.flatMap((l) => l.items);
  const charWidth = median(
    items.map((i) => (i.text.length > 0 ? i.width / i.text.length : i.width)),
  );
  const threshold = Math.max(charWidth * COLUMN_GAP_RATIO, 1);
  const bands = columnBands(items, threshold);

  const grid = region.lines.map((line) => {
    const row: string[] = new Array(bands.length).fill("");
    for (const item of line.items) {
      const text = item.text.trim();
      if (text === "") continue;
      const column = bandFor(item, bands);
      row[column] = row[column] ? `${row[column]} ${text}` : text;
    }
    return row;
  });

  return { grid, bands };
}

/**
 * A cell longer than this is a sentence, not a datum. Chosen because the
 * failure it prevents is the one that matters: a two-column page of prose is
 * perfectly occupied and perfectly regular, so occupancy and consistency both
 * score it 1.0 and it surfaces as a confident table. Cell length is what
 * actually separates the two — a table cell is a label, a count or a
 * measurement.
 */
const MAX_CELL_CHARS = 25;

/**
 * Three measurable properties, all derived from the extracted grid — never a
 * model's self-report:
 *
 * - **Occupancy** — the fraction of cells that hold anything. A grid that is
 *   mostly empty is prose that happened to align.
 * - **Consistency** — the fraction of lines using the same number of occupied
 *   columns as the region's most common count. Real tables are regular.
 * - **Brevity** — the fraction of occupied cells short enough to be data. This
 *   is the one that rejects multi-column prose, which the other two score
 *   perfectly.
 */
export function tableConfidence(grid: string[][]): number {
  if (grid.length === 0 || grid[0].length === 0) return 0;

  const cells = grid.length * grid[0].length;
  const occupied = grid.flat().filter((c) => c !== "");
  if (occupied.length === 0) return 0;
  const occupancy = occupied.length / cells;

  const counts = new Map<number, number>();
  for (const row of grid) {
    const filled = row.filter((c) => c !== "").length;
    counts.set(filled, (counts.get(filled) ?? 0) + 1);
  }
  const modal = Math.max(...counts.values());
  const consistency = modal / grid.length;

  const brevity = occupied.filter((c) => c.length <= MAX_CELL_CHARS).length / occupied.length;

  return Math.round(occupancy * consistency * brevity * 100) / 100;
}

function findCaption(lines: Line[], region: Region): string | null {
  const above = lines[region.startIndex - 1];
  const below = lines[region.endIndex + 1];
  for (const line of [above, below]) {
    if (!line) continue;
    const text = line.items
      .map((i) => i.text.trim())
      .join(" ")
      .trim();
    if (CAPTION_RE.test(text)) return text;
  }
  return null;
}

/** A region this sparse or this irregular is prose, not a table. Surfacing it
 * would make the feature untrustworthy in the one place it must not be. */
const MIN_CONFIDENCE = 0.35;

/** At least this many columns, or it is an indented list. */
const MIN_COLUMNS = 2;

export function detectTables(pageNumber: number, items: PositionedItem[]): ExtractedTable[] {
  const lines = groupIntoLines(items);
  const tables: ExtractedTable[] = [];

  for (const region of findRegions(lines)) {
    const { grid } = buildGrid(region);
    if (grid.length === 0 || grid[0].length < MIN_COLUMNS) continue;

    const confidence = tableConfidence(grid);
    if (confidence < MIN_CONFIDENCE) continue;

    tables.push({
      pageNumber,
      caption: findCaption(lines, region),
      grid,
      confidence,
    });
  }

  return tables;
}
