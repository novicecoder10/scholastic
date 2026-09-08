# Extract Data — Design

Date: 2026-09-06
Sub-project: #7 of 9
Depends on: #2 (document ingestion), #3 (reader, for page jumps), #6 (costing)
Status: approved, not implemented

## What this is

Pull the numbers out of papers, with provenance.

Two surfaces over one primitive:

1. **Per-document extraction** — the tables and reported statistics in one
   uploaded PDF, shown in the reader.
2. **Evidence matrix** — rows are documents, columns are fields the researcher
   types, cells are extracted values. This is where systematic-review value
   lives; the per-document extractor is the unit it is built from.

### Decisions taken before design (2026-09-06)

1. **Scope** — both surfaces. Per-document extraction is the primitive; the
   matrix is the aggregation over it. Building only the primitive would strand
   the workflow that justifies it.
2. **Method** — deterministic geometric table detection, with a single LLM
   call to interpret headers and units. Not LLM-over-text.
3. **Sources** — uploaded PDFs only. No remote fetching of open-access URLs,
   no abstract fallback.

## Two extractions, not one

Tables are a **geometry** problem. Prose statistics are a **semantics**
problem. Treating them as one problem — feeding flattened text to a model and
asking for structure — is exactly why numbers end up in the wrong row: pdfjs
emits text items in draw order, not reading order, so a two-column numeric
table arrives as an interleaved stream.

### Tables — geometric

`lib/pdf/tables.ts`, a pure function. Input is the positioned text items
`unpdf/pdfjs` already exposes via `page.getTextContent()` (each item carries a
`transform` matrix with x/y and a `width`). No new dependency; `unpdf` is
already required by #2.

```ts
export interface PositionedItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ExtractedTable {
  pageNumber: number;
  caption: string | null;
  grid: string[][]; // row-major; empty cells are ""
  confidence: number; // 0..1, computed
}

export function detectTables(pageNumber: number, items: PositionedItem[]): ExtractedTable[];
```

Algorithm:

1. **Lines.** Group items by y within a tolerance derived from item height, so
   subscripts and superscripts join their own line rather than starting one.
2. **Candidate regions.** Find runs of >= 3 consecutive lines that each split
   into >= 2 groups separated by horizontal gaps above a threshold.
3. **Columns.** Cluster item start-x across the whole region (1-D clustering
   with a gap threshold), producing shared column boundaries rather than
   per-line guesses. Right-aligned numeric columns are handled by clustering
   end-x as well and taking whichever produces the tighter clusters.
4. **Cells.** Assign each item to `(line, column)`. Unoccupied cells stay `""`.
5. **Caption.** The nearest line above or below the region matching
   `/^(Table|TABLE)\s+\d+/`.

`confidence` is computed from two measurable properties — how consistently
column boundaries hold across the region's lines, and the fraction of cells
that are non-empty. It is a number derived from the geometry, not a model's
self-report. Low-confidence tables are still surfaced, flagged as such.

### Findings — semantic

Reported statistics live in prose ("we recruited 412 participants",
"p < 0.001, d = 0.42"), which no amount of geometry recovers. These come from
an LLM call over #2's retrieved chunks — retrieval rather than full text,
because full text is both expensive and mostly irrelevant to the fields being
sought.

```ts
export interface ExtractedFinding {
  pageNumber: number;
  field: string; // sample_size | design | p_value | effect_size | ci | ...
  value: string;
  unit: string | null;
  quote: string; // verbatim from the source chunk
}
```

## The non-invention guard

This is the load-bearing part of the design.

**Table interpretation may relabel, never re-value.** One cheap-tier LLM call
per table receives the grid and returns: which row is the header, a unit per
column, and a one-line description. It never returns cell values. On response,
every string it references is checked against the input grid; if anything is
absent, the interpretation is discarded and the raw grid stands unlabelled.

**Every finding must quote its source.** A finding whose `quote` is not a
substring of the chunk text it was extracted from is dropped, silently, before
it reaches the database.

Both checks are mechanical and unit-tested. "The model never invents a number"
is thereby a property of the code rather than a hope about a prompt.

## Data model

```
extraction
  id, documentId, kind ('tables' | 'findings'), status, modelId,
  createdAt, updatedAt
  unique(documentId, kind)       -- re-extraction replaces

extracted_table
  id, documentId, pageNumber, caption, grid jsonb, headerRow integer,
  units jsonb, confidence real, description text
  index(documentId, pageNumber)

extracted_finding
  id, documentId, pageNumber, field, value, unit, quote
  index(documentId, field)

matrix
  id, publicId, userId (nullable), ownerSessionId, title, createdAt
matrix_column
  id, matrixId, position, label, hint text, valueType ('text'|'number'|'list')
matrix_row
  id, matrixId, documentId, position
matrix_cell
  matrixId, rowId, columnId, value, unit, quote, pageNumber,
  status ('found' | 'not_reported' | 'error'), updatedAt
  unique(rowId, columnId)
```

Ownership follows #5's `Owner` resolution exactly — a nullable `userId`
alongside `ownerSessionId`, adopted on sign-in by the same UPDATE.

## The matrix

A cell is filled by **one `retrieveChunks(documentId, column.label)` plus one
LLM call scoped to that (document, column)** — never one large call per paper.

The consequences are the reason for the choice:

- Cells fill in parallel, bounded by a small concurrency limit.
- A failure is one cell, not a row and not the run.
- Re-running a single column or single row touches nothing else, so a
  researcher can refine one field's wording without paying to redo the grid.

### `not_reported` is a first-class status

The single most important correctness property of an evidence matrix is that a
blank cell means _this paper does not report that_, and not _the extractor gave
up_. Three statuses, rendered distinctly:

| Status         | Meaning                                    | UI                    |
| -------------- | ------------------------------------------ | --------------------- |
| `found`        | A value with a page and a quote            | The value, hoverable  |
| `not_reported` | Excerpts retrieved, field genuinely absent | "not reported", muted |
| `error`        | Retrieval or the call failed               | Retry affordance      |

The prompt states explicitly that "not reported" is the correct answer when the
retrieved excerpts do not contain the field, and that guessing from context is
wrong. A model that hedges into a plausible number here is producing a
research-integrity failure, not a UX inconvenience.

### Provenance is mandatory

Every `found` cell carries `pageNumber` and a verbatim `quote`. Hover shows the
quote; click opens `/reader/[documentId]` at that page, reusing #3's page
navigation. **A cell with no quote is never rendered as a value** — it is an
error.

This is the entire difference between a tool usable in a systematic review and
a plausible-looking fabrication.

## Cost

Under #6:

- Table geometry is **free** — deterministic, no provider call.
- Table interpretation, findings extraction, and each matrix cell are metered.
- A matrix fill shows its **estimated cost before running**. A 20x6 matrix is
  120 LLM calls, and the user is told that before clicking, not after.
- Column-level and row-level refill exist so partial work is not re-paid for.

## UI

- `/reader/[documentId]` gains a **Data** tab beside chat: extracted tables
  (raw grid or interpreted, with a confidence flag) and findings, each row
  clicking through to its page.
- `/matrix` — list of the owner's matrices.
- `/matrix/[publicId]` — the grid. Add a row by picking from your documents;
  add a column by typing a field name. That is the whole interaction.
- CSV export for a single table and for a whole matrix, the latter including
  document filename and page per cell.

## Degradation

| Condition             | Behavior                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------ |
| No LLM configured     | Geometric tables still extract, as raw unlabelled grids. No headers, no units, no findings, no matrix. |
| Retrieval unavailable | Findings and cells report `error`, tables unaffected                                                   |
| Zero credits (#6)     | Geometry free and available; metered surfaces show cost and replenishment                              |

## Testing

Node-environment vitest. The weight is on the pure layer, where it belongs.

`detectTables` fixtures are recorded `PositionedItem[]` arrays, so no PDF is
parsed at test time:

- A simple left-aligned table with a header row.
- A right-aligned numeric column (end-x clustering path).
- A table with missing cells.
- Two tables on one page, separated by prose.
- Caption above, and caption below.
- **A page of ordinary two-column prose, which must yield zero tables.**
  False-positive detection is the main risk in this design and gets its own
  fixtures.
- Confidence monotonicity: progressively degrading column alignment produces
  monotonically lower confidence.

Guards:

- An interpretation response containing a cell value absent from the input grid
  is discarded, and the raw grid is retained.
- A finding whose quote is not a substring of its chunk is dropped.

Matrix:

- One failing cell leaves the rest of the row `found`.
- `not_reported` is persisted and rendered distinctly from `error`.
- Re-running one column leaves other columns' `updatedAt` untouched.
- Concurrency limit is respected.

## Non-goals

- **OCR** — inherited from #2. Image-only tables are invisible here.
- **Spanning cells, rotated tables, ruled-line parsing.** A table split across
  pages comes out as two tables.
- **Figure and chart extraction; chart digitization.**
- **Cross-document row deduplication.**
- **Any pooled statistic or meta-analytic computation.** Extraction is not
  synthesis. Silently crossing that line would be a research-integrity
  problem, not a feature.
- **Auto-linking an uploaded PDF to a canonical work.** An upload has no DOI,
  so a matrix of uploads has no citation column. Title-matching against the
  corpus via `lib/merge/matcher.ts` is within technical reach, but it belongs
  to #8, where the writer actually needs the link — half-building it here
  would produce confident wrong attributions.

## New configuration

None. No new dependencies (`unpdf` arrives with #2), no new environment
variables.
