import { inDegreeWithinSet } from "@/lib/graph/analysis";
import { endpointId, type GraphState } from "@/lib/graph/model";

export interface GraphFilters {
  yearFrom: number | null;
  yearTo: number | null;
  minInDegree: number;
  hideUnresolved: boolean;
}

export const EMPTY_GRAPH_FILTERS: GraphFilters = {
  yearFrom: null,
  yearTo: null,
  minInDegree: 0,
  hideUnresolved: false,
};

/**
 * Filtering is what turns the node cap from a wall into a budget. Reaching 150
 * nodes used to print "expand a different branch" with no mechanism for doing
 * so; now a graph can be narrowed and re-grown.
 *
 * Roots always survive. A filter that hides the paper you started from is a
 * filter that looks broken.
 */
export function applyGraphFilters(state: GraphState, filters: GraphFilters): GraphState {
  const inDegree = inDegreeWithinSet(state);

  const kept = new Set(
    state.nodes
      .filter((node) => {
        if (node.isRoot) return true;
        if (filters.hideUnresolved && !node.resolved) return false;
        // A node with no year is kept by a year filter rather than dropped:
        // missing metadata is not evidence of a date outside the range, and
        // silently discarding it hides exactly the under-linked work the
        // coverage caveat is about.
        if (node.year != null) {
          if (filters.yearFrom != null && node.year < filters.yearFrom) return false;
          if (filters.yearTo != null && node.year > filters.yearTo) return false;
        }
        if (filters.minInDegree > 0 && (inDegree.get(node.id) ?? 0) < filters.minInDegree) {
          return false;
        }
        return true;
      })
      .map((node) => node.id),
  );

  if (kept.size === state.nodes.length) return state;

  return {
    nodes: state.nodes.filter((node) => kept.has(node.id)),
    links: state.links.filter(
      (link) => kept.has(endpointId(link.source)) && kept.has(endpointId(link.target)),
    ),
  };
}

/**
 * Removes a node's descendants that are reachable **only** through it.
 *
 * The "only" is the whole substance. A node with another parent is part of the
 * graph independently of the branch being collapsed, and removing it would
 * quietly delete a connection the user never asked to lose — the collapse would
 * then be destructive rather than a view change.
 */
export function collapseNode(state: GraphState, nodeId: string): GraphState {
  const roots = new Set(state.nodes.filter((n) => n.isRoot || n.id === nodeId).map((n) => n.id));

  // Everything still reachable from the roots and the collapsed node itself,
  // WITHOUT traversing out of the collapsed node, is what survives.
  const outgoing = new Map<string, string[]>();
  for (const link of state.links) {
    const from = endpointId(link.source);
    const to = endpointId(link.target);
    for (const [a, b] of [
      [from, to],
      [to, from],
    ]) {
      if (!outgoing.has(a)) outgoing.set(a, []);
      outgoing.get(a)!.push(b);
    }
  }

  const reachable = new Set<string>(roots);
  const stack = [...roots];
  while (stack.length > 0) {
    const current = stack.pop()!;
    // Do not traverse through the collapsed node: that is what makes its
    // exclusive descendants unreachable and everything else survive.
    if (current === nodeId) continue;
    for (const next of outgoing.get(current) ?? []) {
      if (reachable.has(next)) continue;
      reachable.add(next);
      stack.push(next);
    }
  }

  if (reachable.size === state.nodes.length) {
    // Nothing was exclusive to that branch; only the expanded flag changes.
    return {
      nodes: state.nodes.map((n) => (n.id === nodeId ? { ...n, expanded: false } : n)),
      links: state.links,
    };
  }

  return {
    nodes: state.nodes
      .filter((node) => reachable.has(node.id))
      .map((node) => (node.id === nodeId ? { ...node, expanded: false } : node)),
    links: state.links.filter(
      (link) => reachable.has(endpointId(link.source)) && reachable.has(endpointId(link.target)),
    ),
  };
}
