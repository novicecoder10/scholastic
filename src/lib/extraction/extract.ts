import { extractJson } from "@/lib/ai/json";
import { meteredLlm } from "@/lib/credits/metered";
import { detectTables, type ExtractedTable } from "@/lib/pdf/tables";
import { extractPositions } from "@/lib/pdf/positions";
import { keepQuotedFindings, validateInterpretation } from "@/lib/extraction/guards";
import { FINDINGS_PROMPT, TABLE_INTERPRETATION_PROMPT } from "@/lib/extraction/prompts";
import { retrieveChunks } from "@/lib/documents/retrieve";
import { logger } from "@/lib/log/logger";

export interface InterpretedTable extends ExtractedTable {
  headerRow: number | null;
  units: Array<string | null>;
  description: string | null;
}

export interface Finding {
  pageNumber: number;
  field: string;
  value: string;
  unit: string | null;
  quote: string;
}

/**
 * Tables, geometrically. **Free** — no provider call, so this works on an
 * instance with no LLM configured and on an empty credit balance.
 */
export async function extractTables(bytes: Uint8Array): Promise<ExtractedTable[]> {
  const pages = await extractPositions(bytes);
  return pages.flatMap((page) => detectTables(page.pageNumber, page.items));
}

/**
 * One cheap-tier call per table, purely to label it. A failure at any step —
 * no provider, no credits, unparseable output, or an interpretation that
 * referenced something absent from the grid — leaves the raw grid standing
 * unlabelled, which is a worse-looking but honest result.
 */
export async function interpretTable(table: ExtractedTable): Promise<InterpretedTable> {
  const unlabelled: InterpretedTable = {
    ...table,
    headerRow: null,
    units: new Array(table.grid[0]?.length ?? 0).fill(null),
    description: null,
  };

  let metered;
  try {
    metered = await meteredLlm("table_interpretation", "bulk");
  } catch {
    // Includes InsufficientCreditsError: the geometry is already done and free,
    // so a missing balance costs the label, not the table.
    return unlabelled;
  }
  if (!metered) return unlabelled;

  try {
    const raw = await metered.provider.complete({
      model: metered.provider.models.cheap,
      system: TABLE_INTERPRETATION_PROMPT,
      messages: [
        {
          role: "user",
          content: table.grid.map((row, i) => `Row ${i}: ${row.join(" | ")}`).join("\n"),
        },
      ],
      onUsage: metered.onUsage,
      maxTokens: 1200,
    });

    const validated = validateInterpretation(table.grid, extractJson(raw));
    if (!validated) {
      logger.info(
        { event: "table_interpretation_rejected", pageNumber: table.pageNumber },
        "table interpretation discarded; keeping the raw grid",
      );
      return unlabelled;
    }
    return { ...table, ...validated };
  } catch (err) {
    logger.warn(
      { event: "table_interpretation_failed", err: String(err) },
      "interpretation failed",
    );
    return unlabelled;
  }
}

/**
 * Fields worth asking for, phrased as the query that retrieves them. Prose
 * statistics are scattered through a paper, so retrieving per topic beats one
 * pass over the whole text — and costs a fraction as much.
 *
 * Three queries, not the five this started as: on a free-tier backend five
 * sequential calls with 2k-token excerpts hit Groq's per-minute token limit and
 * the last three came back 429. Related fields retrieve the same chunks anyway,
 * so merging them costs nothing in coverage.
 */
const FINDING_QUERIES = [
  "sample size, number of participants recruited and analysed, study duration and follow-up",
  "study design, randomisation, blinding, control condition, primary outcome measure",
  "p values, confidence intervals and effect sizes for the primary outcome",
];

/**
 * Three rather than the default eight. The excerpts are the input token cost,
 * the sought fields cluster in a methods or results section rather than
 * spreading across a paper, and — measured live — the length of a reasoning
 * model's internal trace scales with how much material it is handed. On a
 * free-tier backend that trace is billed against max_tokens before any content
 * is emitted, so a bigger payload turns into an empty answer.
 */
const FINDING_TOP_K = 3;

/**
 * Findings, semantically — from retrieved chunks rather than the full text,
 * which is mostly irrelevant to the fields being sought and expensive to send.
 *
 * Every finding is checked against the exact chunk text it came from before it
 * is returned; anything unquotable is dropped silently, because a dropped
 * finding is a gap and a fabricated one is a lie.
 */
export async function extractFindings(documentId: string): Promise<Finding[]> {
  const found: Finding[] = [];
  const seen = new Set<string>();

  for (const query of FINDING_QUERIES) {
    let chunks;
    try {
      chunks = await retrieveChunks(documentId, query, FINDING_TOP_K);
    } catch (err) {
      logger.warn({ event: "findings_retrieval_failed", err: String(err) }, "retrieval failed");
      continue;
    }
    if (chunks.length === 0) continue;

    let metered;
    try {
      metered = await meteredLlm("findings", "bulk");
    } catch {
      break; // Out of credits: stop rather than retry the same refusal per query.
    }
    if (!metered) break;

    const excerpts = chunks.map((c) => `[page ${c.pageStart}]\n${c.content}`).join("\n\n---\n\n");

    try {
      const raw = await metered.provider.complete({
        model: metered.provider.models.cheap,
        system: FINDINGS_PROMPT,
        messages: [{ role: "user", content: excerpts }],
        onUsage: metered.onUsage,
        // Generous for the same reason topic labelling is: several backends
        // default to a reasoning model, whose trace is billed against
        // max_tokens BEFORE any content is emitted. Observed live at 2000 —
        // finish_reason "length" with an empty string, which is
        // indistinguishable here from a paper that reports nothing.
        maxTokens: 4000,
      });

      const parsed = extractJson(raw) as { findings?: unknown } | null;
      if (!parsed || !Array.isArray(parsed.findings)) continue;

      const candidates = parsed.findings.flatMap((entry): Finding[] => {
        if (typeof entry !== "object" || entry === null) return [];
        const e = entry as Record<string, unknown>;
        if (typeof e.field !== "string" || typeof e.value !== "string") return [];
        if (typeof e.quote !== "string") return [];
        // Attribute the finding to the page whose chunk actually contains the
        // quote, not to the first page retrieved.
        const source = chunks.find((c) => c.content.includes(e.quote as string)) ?? chunks[0];
        return [
          {
            pageNumber: source.pageStart,
            field: e.field,
            value: e.value,
            unit: typeof e.unit === "string" ? e.unit : null,
            quote: e.quote,
          },
        ];
      });

      for (const finding of keepQuotedFindings(excerpts, candidates)) {
        const key = `${finding.field}:${finding.value}`;
        if (seen.has(key)) continue;
        seen.add(key);
        found.push(finding);
      }
    } catch (err) {
      logger.warn({ event: "findings_extraction_failed", err: String(err) }, "extraction failed");
      // A rate limit will hit every remaining query too; continuing just spends
      // the retry budget to collect the same 429 twice more.
      if (String(err).includes("429")) break;
    }
  }

  return found;
}
