import { type CslItem } from "@/lib/citations/csl";

const RIS_TYPES: Record<string, string> = {
  "article-journal": "JOUR",
  "paper-conference": "CPAPER",
  chapter: "CHAP",
  book: "BOOK",
  thesis: "THES",
  report: "RPRT",
  dataset: "DATA",
  article: "JOUR",
  document: "GEN",
};

/**
 * RIS is line-oriented with a fixed `XX  - value` prefix (two spaces before
 * the dash, and that spacing is part of the format — reference managers reject
 * lines without it). A newline inside a value would be read as a new tag, so
 * values are flattened.
 */
function line(tag: string, value: string): string {
  return `${tag}  - ${value.replace(/\s*\n\s*/g, " ")}`;
}

export function formatRis(item: CslItem): string {
  const lines: string[] = [line("TY", RIS_TYPES[item.type] ?? "GEN")];

  for (const author of item.author) {
    lines.push(
      line(
        "AU",
        author.literal ?? (author.given ? `${author.family}, ${author.given}` : author.family),
      ),
    );
  }

  lines.push(line("TI", item.title));

  const parts = item.issued?.["date-parts"][0];
  if (parts) {
    lines.push(line("PY", String(parts[0])));
    // RIS dates are YYYY/MM/DD/ — the trailing slash separates an optional
    // free-text qualifier, and omitting it makes some importers drop the date.
    const [year, month, day] = parts;
    lines.push(
      line(
        "DA",
        `${year}/${month ? String(month).padStart(2, "0") : ""}/${day ? String(day).padStart(2, "0") : ""}/`,
      ),
    );
  }

  const container = item["container-title"];
  if (container) lines.push(line("JO", container));
  if (item.volume) lines.push(line("VL", item.volume));
  if (item.issue) lines.push(line("IS", item.issue));
  if (item.page) {
    const [first, last] = item.page.split(/[-–]/, 2);
    lines.push(line("SP", first));
    if (last) lines.push(line("EP", last));
  }
  if (item.publisher) lines.push(line("PB", item.publisher));
  if (item.DOI) lines.push(line("DO", item.DOI));
  if (item.ISSN) lines.push(line("SN", item.ISSN));
  else if (item.ISBN) lines.push(line("SN", item.ISBN));
  if (item.URL) lines.push(line("UR", item.URL));

  lines.push("ER  - ");
  return lines.join("\n");
}
