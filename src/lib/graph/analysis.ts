import { endpointId, type GraphNode, type GraphState } from "@/lib/graph/model";

/**
 * Deterministic structural analysis. No model, no metered cost, no narration.
 *
 * **Every number here describes the loaded subgraph and nothing else.** Citation
 * coverage is incomplete and biased — OpenAlex, Crossref and Semantic Scholar
 * all have gaps, and preprints and non-English work are systematically
 * under-linked — so a metric presented as a property of "the literature" would
 * be a claim the data cannot support. Every caller labels these accordingly.
 *
 * It is also why cluster narration is refused: a generated paragraph explaining
 * what a cluster "represents" launders incomplete data into confident prose.
 * Edge-level citation reasoning stays, because it is grounded in two specific
 * named papers; set-level narration is not the same thing.
 */

function adjacency(state: GraphState, directed: boolean): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const node of state.nodes) adj.set(node.id, new Set());
  for (const link of state.links) {
    const from = endpointId(link.source);
    const to = endpointId(link.target);
    if (!adj.has(from) || !adj.has(to)) continue;
    adj.get(from)!.add(to);
    if (!directed) adj.get(to)!.add(from);
  }
  return adj;
}

/** Over the undirected projection: two papers in the same conversation are
 * connected whichever way the citation runs. Components are returned
 * largest-first, each sorted, so the output is stable across runs. */
export function connectedComponents(state: GraphState): string[][] {
  const adj = adjacency(state, false);
  const seen = new Set<string>();
  const components: string[][] = [];

  for (const node of state.nodes) {
    if (seen.has(node.id)) continue;
    const stack = [node.id];
    const component: string[] = [];
    seen.add(node.id);
    while (stack.length > 0) {
      const current = stack.pop()!;
      component.push(current);
      for (const neighbour of adj.get(current) ?? []) {
        if (seen.has(neighbour)) continue;
        seen.add(neighbour);
        stack.push(neighbour);
      }
    }
    components.push(component.sort());
  }

  return components.sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
}

/**
 * How many papers **in this graph** cite each node.
 *
 * A different and often more useful number than a global citation count: a
 * paper with 40,000 citations worldwide that nothing else in your reading list
 * cites is peripheral to the question you are actually asking.
 */
export function inDegreeWithinSet(state: GraphState): Map<string, number> {
  const counts = new Map<string, number>(state.nodes.map((n) => [n.id, 0]));
  for (const link of state.links) {
    const target = endpointId(link.target);
    if (counts.has(target)) counts.set(target, counts.get(target)! + 1);
  }
  return counts;
}

/**
 * Shortest path following citation direction, which is what makes it lineage
 * rather than mere connectivity: A cites B cites C means C's ideas reached A.
 *
 * Breadth-first, so the first path found is a shortest one. Returns null when
 * no directed path exists, which is a real and common answer.
 */
export function shortestCitationPath(state: GraphState, from: string, to: string): string[] | null {
  if (from === to) return state.nodes.some((n) => n.id === from) ? [from] : null;
  const adj = adjacency(state, true);
  if (!adj.has(from) || !adj.has(to)) return null;

  const previous = new Map<string, string>();
  const queue = [from];
  const seen = new Set([from]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of adj.get(current) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      previous.set(next, current);
      if (next === to) {
        const path = [to];
        let cursor = to;
        while (previous.has(cursor)) {
          cursor = previous.get(cursor)!;
          path.unshift(cursor);
        }
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}

/** Layer 0 is the earliest year present. Nodes with no year get -1, which the
 * renderer puts in a separate lane — dropping them would hide exactly the
 * preprints and non-English work the coverage caveat is about. */
export function yearLayers(state: GraphState): Map<string, number> {
  const years = state.nodes.map((n) => n.year).filter((y): y is number => typeof y === "number");
  const earliest = years.length > 0 ? Math.min(...years) : 0;
  return new Map(
    state.nodes.map((node) => [node.id, node.year == null ? -1 : node.year - earliest]),
  );
}

export interface GraphSummary {
  nodeCount: number;
  linkCount: number;
  componentCount: number;
  largestComponent: number;
  unresolvedCount: number;
  /** Highest in-degree within the loaded set, with the node that holds it. */
  mostCited: { node: GraphNode; inDegree: number } | null;
}

export function summarise(state: GraphState): GraphSummary {
  const components = connectedComponents(state);
  const inDegree = inDegreeWithinSet(state);

  let mostCited: { node: GraphNode; inDegree: number } | null = null;
  for (const node of state.nodes) {
    const degree = inDegree.get(node.id) ?? 0;
    if (degree > 0 && (!mostCited || degree > mostCited.inDegree)) {
      mostCited = { node, inDegree: degree };
    }
  }

  return {
    nodeCount: state.nodes.length,
    linkCount: state.links.length,
    componentCount: components.length,
    largestComponent: components[0]?.length ?? 0,
    unresolvedCount: state.nodes.filter((n) => !n.resolved).length,
    mostCited,
  };
}
