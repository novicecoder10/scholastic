/**
 * Every prompt here is written around one rule: the model may **label**, and it
 * may say **"not reported"**, but it may never supply a number. The mechanical
 * guards in `guards.ts` enforce that regardless of what the prompt achieves —
 * these exist so the model is not fighting the checks.
 */

export const TABLE_INTERPRETATION_PROMPT = `You are labelling a table that has already been extracted from a research paper. The values are fixed and are not your concern.

You are given a grid of cells, row by row. Return JSON only:

{"headerRow": <0-based row index, or null if there is no header row>,
 "units": [<one entry per column: the unit as written in the table, or null>],
 "description": "<one plain sentence describing what the table reports>"}

Rules, all of which are checked:
- NEVER return a cell value, a corrected value, or a value that is not in the grid. You are not transcribing the table.
- A unit must appear somewhere in the grid as written — in a header, a cell, or in parentheses. If a column's unit is not stated in the table, return null for it. Do not infer the unit that a column of this kind usually has.
- "units" must have exactly one entry per column, in column order.
- The description says what is reported, not what it means. No interpretation of the findings.

Return the JSON object and nothing else.`;

export const FINDINGS_PROMPT = `You extract reported statistics from excerpts of a research paper.

Return JSON only:

{"findings": [{"field": "<one of: sample_size, design, population, duration, p_value, effect_size, confidence_interval, outcome_measure>",
               "value": "<the value exactly as written>",
               "unit": "<unit as written, or null>",
               "quote": "<the verbatim sentence from the excerpt containing this value>"}]}

Rules, all of which are checked mechanically — a finding that breaks one is discarded:
- The quote must be copied CHARACTER FOR CHARACTER from an excerpt. Do not tidy it, complete it, or join two sentences.
- The value must appear inside its own quote. If you cannot quote the value, you do not have the value.
- Extract only what the excerpts state. If the excerpts do not report a field, omit it — an omitted field is correct, an invented one is not.
- Do not compute, convert, round, or combine anything. A percentage you derived is not a reported statistic.

Return {"findings": []} if the excerpts report nothing extractable.

Output the JSON object and nothing else. Do not explain your reasoning, do not restate the excerpts, and do not comment on what you found. Every token you spend thinking is a token the answer does not get.`;

/**
 * The matrix prompt's whole job is making `not_reported` a real answer.
 *
 * A model that hedges into a plausible number when the excerpts are silent is
 * producing a research-integrity failure, not a UX inconvenience, so the
 * instruction is stated first and repeated as the expected default.
 */
export function matrixCellPrompt(label: string, hint: string | null, valueType: string): string {
  return `You are filling ONE cell of an evidence matrix for a systematic review.

Field: "${label}"${hint ? `\nWhat the researcher means by it: ${hint}` : ""}
Expected shape: ${valueType}

"not reported" is the CORRECT and EXPECTED answer whenever the excerpts below do not state this field. Most papers do not report most fields. Guessing from context, inferring from a related number, or supplying what a paper of this kind usually reports is wrong and will be discarded.

Return JSON only:

{"status": "found" | "not_reported",
 "value": "<the value exactly as written, or null>",
 "unit": "<unit as written, or null>",
 "quote": "<the verbatim sentence containing the value, or null>"}

If status is "found" you must supply both a value and a quote, the quote must be copied character for character from an excerpt, and the value must appear inside the quote. All three are checked; a cell that fails becomes "not reported".

Output the JSON object and nothing else. Do not explain your reasoning. This is one small field, not an analysis.`;
}
