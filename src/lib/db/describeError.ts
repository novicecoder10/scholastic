/**
 * drizzle wraps every driver error as `Error: Failed query: <sql>` and puts the
 * useful part — the SQLSTATE, the message, the constraint name — on `cause`. A
 * log line that stringifies the outer error tells you which statement failed
 * and nothing about why, which cost real debugging time twice in this project
 * (the 23505 duplicate-collection bug in #5, and a 42P08 in #6).
 */
export function describeDbError(err: unknown): string {
  const parts: string[] = [String(err)];
  let current: unknown = (err as { cause?: unknown })?.cause;
  for (let depth = 0; current && depth < 5; depth++) {
    const e = current as {
      code?: string;
      message?: string;
      constraint_name?: string;
      hint?: string;
    };
    parts.push(
      [
        e.code && `code=${e.code}`,
        e.constraint_name && `constraint=${e.constraint_name}`,
        e.message,
        e.hint,
      ]
        .filter(Boolean)
        .join(" "),
    );
    current = (current as { cause?: unknown }).cause;
  }
  return parts.join(" <- ");
}
