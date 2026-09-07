import type { CslName } from "@/lib/citations/csl";

/** "John Ronald" → "J. R." — APA and Chicago initialise given names. */
export function initials(given: string | undefined): string {
  if (!given) return "";
  return given
    .split(/[\s.]+/)
    .filter(Boolean)
    .map((part) => `${part[0].toUpperCase()}.`)
    .join(" ");
}

/** "Smith, J. R." — a corporate author renders whole, never inverted. */
export function invertedInitialised(name: CslName): string {
  if (name.literal) return name.literal;
  const given = initials(name.given);
  return given ? `${name.family}, ${given}` : name.family;
}

/** "Smith, John" */
export function invertedFull(name: CslName): string {
  if (name.literal) return name.literal;
  return name.given ? `${name.family}, ${name.given}` : name.family;
}

/** "John Smith" */
export function naturalOrder(name: CslName): string {
  if (name.literal) return name.literal;
  return name.given ? `${name.given} ${name.family}` : name.family;
}

/**
 * Joins a rendered list with the style's conjunction: "A, B, and C".
 *
 * `serialComma` controls the two-item case. Chicago keeps the comma there
 * ("Lin, Michael T., and M. Flint Beal.") because the first name is inverted,
 * so without it the comma inside that name reads as the list separator.
 */
export function joinList(parts: string[], conjunction: string, serialComma = false): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) {
    return `${parts[0]}${serialComma ? "," : ""} ${conjunction} ${parts[1]}`;
  }
  return `${parts.slice(0, -1).join(", ")}, ${conjunction} ${parts[parts.length - 1]}`;
}
