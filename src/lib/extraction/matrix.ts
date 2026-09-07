import { extractJson } from "@/lib/ai/json";
import { meteredLlm } from "@/lib/credits/metered";
import { quoteAppearsIn } from "@/lib/extraction/guards";
import { matrixCellPrompt } from "@/lib/extraction/prompts";
import { retrieveChunks } from "@/lib/documents/retrieve";
import { logger } from "@/lib/log/logger";

export type CellStatus = "found" | "not_reported" | "error";

/** One cell asks one narrow question; four excerpts answer it, and a wide
 * matrix multiplies whatever this is by rows times columns. */
const CELL_TOP_K = 4;

export interface CellResult {
  status: CellStatus;
  value: string | null;
  unit: string | null;
  quote: string | null;
  pageNumber: number | null;
  error: string | null;
}

export interface ColumnSpec {
  id: number;
  label: string;
  hint: string | null;
  valueType: string;
}

const NOT_REPORTED: CellResult = {
  status: "not_reported",
  value: null,
  unit: null,
  quote: null,
  pageNumber: null,
  error: null,
};

function failed(error: string): CellResult {
  return { ...NOT_REPORTED, status: "error", error };
}

/**
 * One cell: one retrieval plus one LLM call, scoped to that (document, column).
 *
 * Never one large call per paper, and the consequences are the reason: cells
 * fill in parallel, a failure is one cell rather than a row, and re-running a
 * single column touches nothing else — so refining one field's wording does not
 * mean paying to redo the grid.
 */
export async function fillCell(documentId: string, column: ColumnSpec): Promise<CellResult> {
  let chunks;
  try {
    chunks = await retrieveChunks(documentId, column.hint ?? column.label, CELL_TOP_K);
  } catch (err) {
    logger.warn({ event: "matrix_retrieval_failed", err: String(err) }, "cell retrieval failed");
    return failed("Couldn't read this document.");
  }
  // No excerpts is genuinely "the paper doesn't discuss this", not a failure.
  if (chunks.length === 0) return NOT_REPORTED;

  let metered;
  try {
    metered = await meteredLlm("matrix_cell", "bulk");
  } catch (err) {
    return failed(err instanceof Error ? err.message : "Not enough credits.");
  }
  if (!metered) return failed("No AI provider is configured.");

  const excerpts = chunks.map((c) => `[page ${c.pageStart}]\n${c.content}`).join("\n\n---\n\n");

  try {
    const raw = await metered.provider.complete({
      model: metered.provider.models.cheap,
      system: matrixCellPrompt(column.label, column.hint, column.valueType),
      messages: [{ role: "user", content: excerpts }],
      onUsage: metered.onUsage,
      // A reasoning-model backend spends its budget on the trace before
      // emitting anything, and a truncated cell reads as "not reported" — the
      // one wrong answer this design cannot afford to produce silently.
      maxTokens: 2500,
    });

    const parsed = extractJson(raw) as Record<string, unknown> | null;
    if (!parsed) return failed("Couldn't read the model's answer.");
    if (parsed.status !== "found") return NOT_REPORTED;

    const value = typeof parsed.value === "string" ? parsed.value.trim() : "";
    const quote = typeof parsed.quote === "string" ? parsed.quote.trim() : "";

    // A cell claiming "found" without provenance degrades to "not reported"
    // rather than to an error: the excerpts were read, and an unquotable answer
    // is indistinguishable from the field being absent. Presenting it as a
    // value is the one outcome that is never acceptable.
    if (!value || !quote) return NOT_REPORTED;
    if (!quoteAppearsIn(excerpts, quote) || !quoteAppearsIn(quote, value)) {
      logger.info(
        { event: "matrix_cell_unquotable", documentId, column: column.label },
        "matrix cell discarded: value not present in a verbatim quote",
      );
      return NOT_REPORTED;
    }

    const source = chunks.find((c) => quoteAppearsIn(c.content, quote)) ?? chunks[0];
    return {
      status: "found",
      value,
      unit: typeof parsed.unit === "string" && parsed.unit.trim() ? parsed.unit.trim() : null,
      quote,
      pageNumber: source.pageStart,
      error: null,
    };
  } catch (err) {
    logger.warn({ event: "matrix_cell_failed", err: String(err) }, "matrix cell failed");
    return failed("That cell couldn't be filled — try again.");
  }
}

/** Small enough that a wide matrix does not open fifty connections to one
 * provider and trip its rate limit; large enough that a 20x6 fill is not
 * serial. */
export const CELL_CONCURRENCY = 4;

export interface CellJob {
  rowId: number;
  documentId: string;
  column: ColumnSpec;
}

/**
 * Runs jobs with a bounded number in flight, resolving each independently. One
 * cell failing never rejects the run — a half-filled matrix with three error
 * cells is useful, and an exception that discards the other 117 results is not.
 */
export async function fillCells(
  jobs: CellJob[],
  onResult: (job: CellJob, result: CellResult) => Promise<void>,
  concurrency = CELL_CONCURRENCY,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      let result: CellResult;
      try {
        result = await fillCell(job.documentId, job.column);
      } catch (err) {
        result = failed(String(err));
      }
      try {
        await onResult(job, result);
      } catch (err) {
        logger.warn({ event: "matrix_cell_persist_failed", err: String(err) }, "cell not saved");
      }
    }
  });
  await Promise.all(workers);
}
