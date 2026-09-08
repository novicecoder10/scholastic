import type { CanonicalWork } from "@/lib/types/work";
import type { CitationStyle } from "@/lib/citations";
import { bibtexKey } from "@/lib/citations/format/bibtex";
import { toCsl } from "@/lib/citations/csl";
import { formatCitation } from "@/lib/citations";
import {
  BROKEN_CITATION_LABEL,
  buildBibliography,
  collectCitedWorkKeys,
  inlineLabel,
} from "@/lib/manuscript/bibliography";
import { CITATION_NODE, type DocNode } from "@/lib/manuscript/types";

export type ExportFormat = "markdown" | "latex" | "bibtex" | "ris";

interface RenderContext {
  order: string[];
  resolved: Map<string, CanonicalWork | null>;
  style: CitationStyle;
}

/** How a citation node appears in the exported body. Markdown keeps the same
 * label the editor shows; LaTeX emits `\cite{key}` so the `.bib` does the
 * labelling, which is the whole point of the format. */
function citationText(workKey: string, format: ExportFormat, context: RenderContext): string {
  const index = context.order.indexOf(workKey);
  const work = context.resolved.get(workKey) ?? null;

  if (format === "latex") {
    if (!work) return "\\textbf{[missing citation]}";
    // Through toCsl, so the key here is byte-identical to the one #4 emits in
    // the .bib — the one way a LaTeX export usually breaks.
    return `\\cite{${bibtexKey(toCsl(work))}}`;
  }
  return inlineLabel({ workKey, work }, index < 0 ? 0 : index, context.style);
}

/** LaTeX's five reserved characters in body text. A manuscript containing a
 * literal `%` should not silently comment out the rest of its line. */
function escapeLatex(text: string): string {
  return text
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([&%$#_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}");
}

function inlineText(node: DocNode, format: ExportFormat, context: RenderContext): string {
  if (node.type === CITATION_NODE) {
    const key = typeof node.attrs?.workKey === "string" ? node.attrs.workKey : "";
    return citationText(key, format, context);
  }
  if (typeof node.text === "string") {
    const raw = format === "latex" ? escapeLatex(node.text) : node.text;
    const marks = new Set((node.marks ?? []).map((m) => m.type));
    if (format === "latex") {
      let out = raw;
      if (marks.has("italic")) out = `\\emph{${out}}`;
      if (marks.has("bold")) out = `\\textbf{${out}}`;
      return out;
    }
    let out = raw;
    if (marks.has("italic")) out = `*${out}*`;
    if (marks.has("bold")) out = `**${out}**`;
    return out;
  }
  return (node.content ?? []).map((child) => inlineText(child, format, context)).join("");
}

function blockText(node: DocNode, format: ExportFormat, context: RenderContext): string {
  const inner = (node.content ?? []).map((c) => inlineText(c, format, context)).join("");

  switch (node.type) {
    case "heading": {
      const level = Number(node.attrs?.level ?? 1);
      if (format === "latex") {
        const command = level <= 1 ? "section" : level === 2 ? "subsection" : "subsubsection";
        return `\\${command}{${inner}}`;
      }
      return `${"#".repeat(Math.min(6, Math.max(1, level)))} ${inner}`;
    }
    case "blockquote":
      return format === "latex"
        ? `\\begin{quote}\n${inner}\n\\end{quote}`
        : inner
            .split("\n")
            .map((line) => `> ${line}`)
            .join("\n");
    case "bulletList":
    case "orderedList": {
      const items = (node.content ?? []).map((item) =>
        (item.content ?? []).map((c) => blockText(c, format, context)).join(" "),
      );
      if (format === "latex") {
        const env = node.type === "bulletList" ? "itemize" : "enumerate";
        return `\\begin{${env}}\n${items.map((i) => `  \\item ${i}`).join("\n")}\n\\end{${env}}`;
      }
      return items
        .map((item, i) => (node.type === "bulletList" ? `- ${item}` : `${i + 1}. ${item}`))
        .join("\n");
    }
    default:
      return inner;
  }
}

export interface ExportResult {
  content: string;
  /** LaTeX exports a companion .bib; every other format is a single file. */
  bib?: string;
  filename: string;
  contentType: string;
}

function safeStem(title: string): string {
  return (
    title
      .replace(/[^A-Za-z0-9 _-]/g, "")
      .trim()
      .slice(0, 60) || "manuscript"
  );
}

export function exportManuscript(
  doc: DocNode,
  title: string,
  resolved: Map<string, CanonicalWork | null>,
  style: CitationStyle,
  format: ExportFormat,
): ExportResult {
  const order = collectCitedWorkKeys(doc);
  const context: RenderContext = { order, resolved, style };
  const stem = safeStem(title);

  // BibTeX and RIS are bibliography-only: the body has no place in them, and
  // #4's formatters already produce both from a CanonicalWork.
  if (format === "bibtex" || format === "ris") {
    const entries = order
      .map((key) => resolved.get(key))
      .filter((work): work is CanonicalWork => Boolean(work))
      .map((work) => formatCitation(work, format).text);
    return {
      content: entries.join("\n\n"),
      filename: `${stem}.${format === "bibtex" ? "bib" : "ris"}`,
      contentType:
        format === "bibtex" ? "application/x-bibtex" : "application/x-research-info-systems",
    };
  }

  const body = (doc.content ?? [])
    .map((node) => blockText(node, format, context))
    .filter((block) => block.trim() !== "")
    .join("\n\n");

  if (format === "latex") {
    // The keys in \cite{} and the keys in the .bib are both bibtexKey(work), so
    // they cannot drift — which is the one way a LaTeX export usually breaks.
    const bib = order
      .map((key) => resolved.get(key))
      .filter((work): work is CanonicalWork => Boolean(work))
      .map((work) => formatCitation(work, "bibtex").text)
      .join("\n\n");
    const content = [
      "\\documentclass{article}",
      "\\usepackage[utf8]{inputenc}",
      `\\title{${escapeLatex(title)}}`,
      "\\begin{document}",
      "\\maketitle",
      "",
      body,
      "",
      `\\bibliographystyle{plain}`,
      `\\bibliography{${stem}}`,
      "\\end{document}",
    ].join("\n");
    return {
      content,
      bib,
      filename: `${stem}.tex`,
      contentType: "application/x-tex",
    };
  }

  const bibliography = buildBibliography(order, resolved, style);
  const lines = bibliography.map(
    (entry) => `- ${entry.missing ? `${BROKEN_CITATION_LABEL} (${entry.workKey})` : entry.text}`,
  );
  const content = [`# ${title}`, "", body, "", "## References", "", ...lines].join("\n");
  return { content, filename: `${stem}.md`, contentType: "text/markdown; charset=utf-8" };
}
