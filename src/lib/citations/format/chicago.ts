import { cslYear, type CslItem } from "@/lib/citations/csl";
import { invertedFull, joinList, naturalOrder } from "@/lib/citations/format/names";

/** Chicago (notes-bibliography, bibliography entry): first author inverted,
 * the rest natural order, "et al." from eleven authors on. */
function authors(item: CslItem): string {
  const names = item.author;
  if (names.length === 0) return "";
  if (names.length === 1) return `${invertedFull(names[0])}.`;
  if (names.length > 10) return `${invertedFull(names[0])}, et al.`;

  const rest = names.slice(1).map(naturalOrder);
  return `${joinList([invertedFull(names[0]), ...rest], "and", true)}.`;
}

export function formatChicago(item: CslItem): string {
  const parts: string[] = [];

  const who = authors(item);
  if (who) parts.push(who);

  const year = cslYear(item);
  parts.push(year ? `${year}.` : "n.d.");
  parts.push(`"${item.title.replace(/\.$/, "")}."`);

  const container = item["container-title"];
  if (container) {
    let source = container;
    if (item.volume) source += ` ${item.volume}`;
    if (item.issue) source += `, no. ${item.issue}`;
    if (item.page) source += `: ${item.page}`;
    parts.push(`${source}.`);
  } else if (item.publisher) {
    parts.push(`${item.publisher}.`);
  }

  if (item.DOI) parts.push(`https://doi.org/${item.DOI}.`);
  else if (item.URL) parts.push(`${item.URL}.`);

  return parts.join(" ");
}
