"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CitationNode } from "@/components/manuscript/citationNode";
import { CitePicker } from "@/components/manuscript/CitePicker";
import { DraftPanel } from "@/components/manuscript/DraftPanel";
import { SupportPanel } from "@/components/manuscript/SupportPanel";
import { CITATION_STYLES, type CitationStyle } from "@/lib/citations";
import { MANUSCRIPT_STYLES } from "@/lib/manuscript/bibliography";
import { BROKEN_CITATION_LABEL } from "@/lib/manuscript/bibliography";
import type { DocNode } from "@/lib/manuscript/types";

export interface BibliographyEntryDto {
  workKey: string;
  text: string | null;
  missing: boolean;
}

export interface SavedWorkOption {
  workKey: string;
  title: string;
  authors: string[];
  year: number | null;
}

const AUTOSAVE_DEBOUNCE_MS = 1200;

export function ManuscriptEditor({
  publicId,
  title,
  initialDoc,
  initialStyle,
  initialBibliography,
  savedWorks,
  aiEnabled,
}: {
  publicId: string;
  title: string;
  initialDoc: DocNode;
  initialStyle: CitationStyle;
  initialBibliography: BibliographyEntryDto[];
  savedWorks: SavedWorkOption[];
  aiEnabled: boolean;
}) {
  const [style, setStyle] = useState<CitationStyle>(initialStyle);
  const [bibliography, setBibliography] = useState(initialBibliography);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editor = useEditor({
    // Tiptap warns loudly without this in a React 18/19 SSR tree, and the
    // editor is client-only anyway.
    immediatelyRender: false,
    extensions: [StarterKit, CitationNode],
    content: initialDoc as object,
    editorProps: {
      attributes: {
        class: "manuscript-prose focus:outline-none min-h-[24rem]",
      },
    },
  });

  const save = useCallback(
    async (payload: { doc?: unknown; citationStyle?: string }) => {
      setSaveState("saving");
      try {
        const response = await fetch(`/api/manuscripts/${publicId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!response.ok) return setSaveState("error");
        const body = (await response.json()) as { bibliography: BibliographyEntryDto[] };
        setBibliography(body.bibliography);
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    },
    [publicId],
  );

  // Autosave, debounced. The document is the only thing here that cannot be
  // reconstructed, so it is written far more eagerly than anything else in the
  // app.
  useEffect(() => {
    if (!editor) return;
    const onUpdate = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void save({ doc: editor.getJSON() }), AUTOSAVE_DEBOUNCE_MS);
    };
    editor.on("update", onUpdate);
    return () => {
      editor.off("update", onUpdate);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [editor, save]);

  /**
   * Labels are pushed into the nodes from the derived bibliography — they are
   * never computed here and never stored. The document holds workKeys; the
   * server holds the one formatter. A second implementation of labelling in the
   * client is how the editor and the export start disagreeing.
   */
  useEffect(() => {
    if (!editor) return;
    const labels = new Map<string, string>();
    bibliography.forEach((entry, index) => {
      labels.set(
        entry.workKey,
        entry.missing ? BROKEN_CITATION_LABEL : inlineFor(entry, index, style),
      );
    });

    const { state, view } = editor;
    const tr = state.tr;
    let changed = false;
    state.doc.descendants((node, pos) => {
      if (node.type.name !== "citation") return;
      const wanted = labels.get(node.attrs.workKey) ?? BROKEN_CITATION_LABEL;
      if (node.attrs.label === wanted) return;
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, label: wanted });
      changed = true;
    });
    if (changed) {
      // addToHistory: false — relabelling is derived state, and it must not
      // consume a step of the writer's undo stack.
      tr.setMeta("addToHistory", false);
      view.dispatch(tr);
    }
  }, [editor, bibliography, style]);

  const citedKeys = useMemo(() => new Set(bibliography.map((b) => b.workKey)), [bibliography]);

  function insertCitation(workKey: string) {
    editor?.chain().focus().insertCitation(workKey).run();
    if (editor) void save({ doc: editor.getJSON() });
  }

  async function changeStyle(next: CitationStyle) {
    setStyle(next);
    // A style change is a re-render, never a rewrite: not one node in the
    // document is touched.
    await save({ citationStyle: next });
  }

  const selection = editor
    ? editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, " ")
    : "";

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <div className="min-w-0 flex-1">
        <div className="border-line mb-3 flex flex-wrap items-center gap-2 border-b pb-3">
          <ToolbarButton editor={editor} action="toggleBold" label="B" title="Bold" />
          <ToolbarButton editor={editor} action="toggleItalic" label="I" title="Italic" />
          <ToolbarButton
            editor={editor}
            action="toggleBulletList"
            label="•"
            title="Bulleted list"
          />
          <ToolbarButton editor={editor} action="toggleBlockquote" label="❞" title="Quote" />

          <label htmlFor="citation-style" className="text-muted ml-2 text-xs">
            Style
          </label>
          <select
            id="citation-style"
            value={style}
            onChange={(e) => void changeStyle(e.target.value as CitationStyle)}
            className="border-line bg-page text-ink rounded-lg border px-2 py-1 text-xs outline-none"
          >
            {CITATION_STYLES.filter((option) => MANUSCRIPT_STYLES.includes(option.id)).map(
              (option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ),
            )}
          </select>

          <span className="text-muted ml-auto text-xs" role="status">
            {saveState === "saving" ? "Saving…" : saveState === "error" ? "Not saved" : "Saved"}
          </span>
        </div>

        <EditorContent editor={editor} />

        {notice && (
          <p className="border-line bg-surface text-ink mt-4 rounded-xl border p-3 text-sm" role="status">
            {notice}
          </p>
        )}
      </div>

      <aside className="w-full shrink-0 space-y-6 lg:w-80">
        <CitePicker works={savedWorks} cited={citedKeys} onInsert={insertCitation} />

        <SupportPanel
          claim={selection}
          enabled={aiEnabled}
          onInsert={insertCitation}
          onNotice={setNotice}
        />

        <DraftPanel
          publicId={publicId}
          works={savedWorks}
          enabled={aiEnabled}
          onNotice={setNotice}
          onInsert={(sentences) => {
            if (!editor) return;
            const content = sentences.map((segments) => ({
              type: "paragraph",
              content: segments.map((segment) =>
                segment.kind === "citation"
                  ? { type: "citation", attrs: { workKey: segment.workKey } }
                  : { type: "text", text: segment.value },
              ),
            }));
            editor.chain().focus().insertContent(content).run();
            void save({ doc: editor.getJSON() });
          }}
        />

        <section>
          <h2 className="text-ink mb-2 text-sm font-semibold">Bibliography</h2>
          {bibliography.length === 0 ? (
            <p className="text-muted text-sm">
              Nothing cited yet. Inserting a citation adds its entry here, in the order it first
              appears.
            </p>
          ) : (
            <ol className="space-y-2 text-xs">
              {bibliography.map((entry, index) => (
                <li key={entry.workKey} className={entry.missing ? "text-danger" : "text-ink/80"}>
                  <span className="metric text-muted mr-1">{index + 1}.</span>
                  {entry.missing
                    ? `${BROKEN_CITATION_LABEL} — ${entry.workKey}`
                    : entry.text}
                </li>
              ))}
            </ol>
          )}
        </section>

        <section>
          <h2 className="text-ink mb-2 text-sm font-semibold">Export</h2>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["markdown", "Markdown"],
                ["latex", "LaTeX"],
                ["bibtex", "BibTeX"],
                ["ris", "RIS"],
              ] as const
            ).map(([format, label]) => (
              <a
                key={format}
                href={`/api/manuscripts/${publicId}/export?format=${format}`}
                className="border-line text-muted hover:border-accent hover:text-accent rounded-full border px-3 py-1 text-xs font-medium transition-colors"
              >
                {label}
              </a>
            ))}
          </div>
          <p className="text-muted mt-2 text-xs">
            Every export is deterministic and free — no model is involved. {title} is written from
            the same formatters the Cite button uses.
          </p>
        </section>
      </aside>
    </div>
  );
}

/** Mirrors the server's inline label. Kept to a single call site so there is
 * one place to keep in step with `lib/manuscript/bibliography.ts`. */
function inlineFor(entry: BibliographyEntryDto, index: number, style: CitationStyle): string {
  // The formatted entry opens with the author, which is what an author-date
  // label needs. Falling back to the position number is better than printing a
  // name parsed wrongly.
  const surname = entry.text?.match(/^([^,(]+)/)?.[1]?.trim().split(/\s+/)[0];
  if (!surname) return `[${index + 1}]`;
  if (style === "mla") return `(${surname})`;
  const year = entry.text?.match(/\((\d{4})\)/)?.[1] ?? "n.d.";
  return `(${surname}, ${year})`;
}

function ToolbarButton({
  editor,
  action,
  label,
  title,
}: {
  /** Null until the editor mounts — the buttons render disabled-ish rather
   * than being conditionally absent, which would shift the toolbar. */
  editor: ReturnType<typeof useEditor> | null;
  action: "toggleBold" | "toggleItalic" | "toggleBulletList" | "toggleBlockquote";
  label: string;
  title: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={() => editor?.chain().focus()[action]().run()}
      className="border-line text-muted hover:border-accent hover:text-accent rounded-lg border px-2 py-1 text-xs transition-colors"
    >
      {label}
    </button>
  );
}
