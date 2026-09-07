/**
 * The document shape the pure layer walks. A structural subset of Tiptap's
 * `JSONContent`, declared here so `lib/manuscript/*` — which is where all the
 * logic lives and all the tests point — never imports an editor package.
 */
export interface DocNode {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

export const CITATION_NODE = "citation";
