/**
 * The graph's data model, with no React and no renderer in sight.
 *
 * All of this used to live inside `CitationGraph.tsx`, where none of it could
 * be tested. Extracting it is the precondition for everything else in #9: the
 * analysis, the filters and the identity resolution are all pure functions over
 * these types.
 */

export interface CitationRef {
  doi: string | null;
  title: string | null;
  year: number | null;
}

export interface GraphNode {
  /** The app's own work identity — `doi:…`, `title:…`, or `unresolved:…`. */
  id: string;
  workKey: string;
  label: string;
  isRoot: boolean;
  doi: string | null;
  year: number | null;
  /** False for a node we could not resolve to a work: it renders dimmed and
   * cannot be expanded, and the inspector says why. */
  resolved: boolean;
  expandable: boolean;
  expanded: boolean;
  /** True when this work is in the viewer's library — set by the caller, since
   * the pure layer knows nothing about accounts. */
  inLibrary?: boolean;
}

export interface GraphLink {
  /**
   * Plain string ids as constructed. `react-force-graph-2d` mutates these in
   * place into node objects once its simulation initialises, so anything
   * reading a link back must handle both — see `endpointId`.
   */
  source: string | GraphNode;
  target: string | GraphNode;
  /** `source` cites `target`, whichever direction the fetch called it. */
  kind: "citing" | "cited";
}

export interface GraphState {
  nodes: GraphNode[];
  links: GraphLink[];
}

export function endpointId(ref: string | GraphNode): string {
  return typeof ref === "string" ? ref : ref.id;
}

/** Beyond this the canvas is unreadable and the simulation is slow. It is a
 * budget rather than a wall: #9 adds collapse and filters so a full graph can
 * be traded down instead of merely refusing to grow. */
export const MAX_NODES = 150;
