import type { CanonicalWork } from "@/lib/types/work";
import type { CitationStyle } from "@/lib/citations";
import {
  BROKEN_CITATION_LABEL,
  buildBibliography,
  inlineLabel,
} from "@/lib/manuscript/bibliography";
import { bulletSegments, collectDeckWorkKeys, type DeckOutline } from "@/lib/deck/outline";

/**
 * Markdown with `---` slide breaks and a Marp front-matter block.
 *
 * Marp because it is the one deck format that is still a text file: it opens in
 * any editor, renders in VS Code, converts to PDF or PPTX with one command, and
 * diffs in git. Emitting a binary .pptx from here would mean a new dependency
 * that writes an opaque zip this project could never test the contents of, to
 * produce a file the user can already generate from this one.
 */
export function renderDeckMarkdown(
  deckTitle: string,
  outline: DeckOutline,
  resolved: Map<string, CanonicalWork | null>,
  style: CitationStyle,
): string {
  const order = collectDeckWorkKeys(outline);

  const label = (workKey: string): string => {
    const index = order.indexOf(workKey);
    return inlineLabel(
      { workKey, work: resolved.get(workKey) ?? null },
      index < 0 ? 0 : index,
      style,
    );
  };

  const slides = outline.slides.map((slide) => {
    const bullets = slide.bullets.map((bullet) => {
      const text = bulletSegments(bullet)
        .map((segment) => (segment.kind === "text" ? segment.value : label(segment.workKey)))
        .join("")
        .replace(/\s{2,}/g, " ")
        .trim();
      return `- ${text}`;
    });
    return [`## ${slide.title}`, "", ...bullets].join("\n");
  });

  const references = buildBibliography(order, resolved, style).map(
    (entry, i) =>
      `${i + 1}. ${entry.missing ? `${BROKEN_CITATION_LABEL} (${entry.workKey})` : entry.text}`,
  );

  return [
    "---",
    "marp: true",
    "paginate: true",
    "---",
    "",
    `# ${deckTitle}`,
    "",
    ...slides.flatMap((slide) => ["---", "", slide, ""]),
    "---",
    "",
    "## References",
    "",
    ...(references.length > 0 ? references : ["_No sources cited._"]),
    "",
  ].join("\n");
}

export function deckFilename(deckTitle: string): string {
  const stem =
    deckTitle
      .replace(/[^A-Za-z0-9 _-]/g, "")
      .trim()
      .slice(0, 60) || "deck";
  return `${stem}.md`;
}
