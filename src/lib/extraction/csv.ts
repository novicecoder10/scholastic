/**
 * CSV, RFC 4180. Pure so the escaping is unit-tested rather than eyeballed in a
 * spreadsheet.
 */

/**
 * A field beginning with `=`, `+`, `-` or `@` is executed as a formula when the
 * file is opened in Excel or Sheets. Extracted values legitimately begin with
 * "-" (a negative effect size) and "=" appears in quoted statistics, so the
 * field is prefixed with a tab rather than mangled: spreadsheets read it as
 * text, and the value is still visible and correct.
 */
function neutraliseFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `\t${value}` : value;
}

export function csvField(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  const safe = neutraliseFormula(value);
  // A neutralised field is always quoted: the guard tab is significant
  // whitespace, and an unquoted leading tab is at the mercy of whatever the
  // reader does with surrounding space.
  if (safe !== value || /[",\n\r]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}

export function toCsv(rows: Array<Array<string | null | undefined>>): string {
  // CRLF, because RFC 4180 says so and because Excel on Windows needs it.
  return rows.map((row) => row.map(csvField).join(",")).join("\r\n");
}
