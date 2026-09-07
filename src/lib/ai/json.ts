/**
 * Models wrap JSON in prose or a code fence often enough that unwrapping it is
 * required rather than defensive.
 *
 * Extracted here on its fourth copy: `queryUnderstanding`, `labelTopics`, and
 * both of #7's extractors need identical behaviour, and three near-identical
 * private versions is how they quietly stop being identical.
 */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}
