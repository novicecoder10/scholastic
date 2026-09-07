import { cslYear, type CslItem } from "@/lib/citations/csl";
import { invertedFull, naturalOrder } from "@/lib/citations/format/names";

/** MLA 9 names one author, "X and Y" for two, and "X, et al." for three or
 * more. Only the first author is inverted. */
function authors(item: CslItem): string {
  const names = item.author;
  if (names.length === 0) return "";
  if (names.length === 1) return `${invertedFull(names[0])}.`;
  if (names.length === 2) return `${invertedFull(names[0])}, and ${naturalOrder(names[1])}.`;
  return `${invertedFull(names[0])}, et al.`;
}

export function formatMla(item: CslItem): string {
  const parts: string[] = [];

  const who = authors(item);
  if (who) parts.push(who);

  parts.push(`"${item.title.replace(/\.$/, "")}."`);

  const container = item["container-title"];
  if (container) {
    const details = [`*${container}*`];
    if (item.volume) details.push(`vol. ${item.volume}`);
    if (item.issue) details.push(`no. ${item.issue}`);
    const year = cslYear(item);
    if (year) details.push(String(year));
    if (item.page) details.push(`pp. ${item.page}`);
    parts.push(`${details.join(", ")}.`);
  } else {
    if (item.publisher) parts.push(`${item.publisher},`);
    const year = cslYear(item);
    parts.push(year ? `${year}.` : "n.d.");
  }

  if (item.DOI) parts.push(`https://doi.org/${item.DOI}.`);
  else if (item.URL) parts.push(`${item.URL}.`);

  return parts.join(" ");
}
