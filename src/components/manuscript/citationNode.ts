import { Node, mergeAttributes } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    citation: {
      insertCitation: (workKey: string) => ReturnType;
    };
  }
}

/**
 * An inline atom carrying exactly one attribute: the workKey.
 *
 * No number. No author-year string. Nothing about how it renders. The label is
 * derived at render time from document order and the active style, which is
 * what makes reordering renumber, style switching a re-render rather than a
 * rewrite, deleting a sentence remove its bibliography entry, and the same work
 * cited twice collapse to one entry.
 *
 * It is also the whole reason this feature uses ProseMirror instead of a
 * markdown textarea.
 */
export const CitationNode = Node.create({
  name: "citation",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      workKey: { default: null },
      /** Presentation only, refreshed from the server's derived bibliography.
       * Never the source of truth, and never persisted as meaning — a document
       * whose labels were stored would disagree with itself the moment the
       * style changed. */
      label: { default: null, rendered: false },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-citation]" }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-citation": node.attrs.workKey,
        class: "citation-chip",
      }),
      node.attrs.label ?? "[?]",
    ];
  },

  addCommands() {
    return {
      insertCitation:
        (workKey: string) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { workKey } }),
    };
  },
});
