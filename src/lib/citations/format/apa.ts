import { cslYear, type CslItem } from "@/lib/citations/csl";
import { invertedInitialised } from "@/lib/citations/format/names";

/** APA 7 lists up to 20 authors; at 21 or more it gives the first 19, an
 * ellipsis, and the final author. This rule is the reason hand-written
 * formatters beat "join with commas". */
const APA_MAX_LISTED = 20;

function authors(item: CslItem): string {
  const names = item.author.map(invertedInitialised);
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];

  if (names.length > APA_MAX_LISTED) {
    return `${names.slice(0, 19).join(", ")}, . . . ${names[names.length - 1]}`;
  }
  return `${names.slice(0, -1).join(", ")}, & ${names[names.length - 1]}`;
}

/** Sentence-final period, without doubling one the title already ends with. */
function endSentence(text: string): string {
  return /[.?!]$/.test(text) ? text : `${text}.`;
}

export function formatApa(item: CslItem): string {
  const parts: string[] = [];

  const who = authors(item);
  if (who) parts.push(endSentence(who));

  const year = cslYear(item);
  parts.push(`(${year ?? "n.d."}).`);
  parts.push(endSentence(item.title));

  const container = item["container-title"];
  if (container) {
    let source = container;
    if (item.volume) {
      source += `, ${item.volume}`;
      if (item.issue) source += `(${item.issue})`;
    }
    if (item.page) source += `, ${item.page}`;
    parts.push(endSentence(source));
  } else if (item.publisher) {
    parts.push(endSentence(item.publisher));
  }

  if (item.DOI) parts.push(`https://doi.org/${item.DOI}`);
  else if (item.URL) parts.push(item.URL);

  return parts.join(" ");
}
