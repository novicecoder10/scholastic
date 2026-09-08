import {
  endpointId,
  MAX_NODES,
  type CitationRef,
  type GraphLink,
  type GraphNode,
  type GraphState,
} from "@/lib/graph/model";
import { resolveRef } from "@/lib/graph/identity";

export interface SeedRoot {
  workKey: string;
  title: string;
  doi: string | null;
  year: number | null;
}

function nodeFromRef(ref: CitationRef): GraphNode {
  const resolved = resolveRef(ref);
  return {
    id: resolved.workKey,
    workKey: resolved.workKey,
    label: resolved.title ?? resolved.doi ?? "Untitled",
    isRoot: false,
    doi: resolved.doi,
    year: resolved.year,
    resolved: resolved.resolved,
    // Expanding needs a DOI to look citations up by, so an unresolved node is
    // a leaf whatever else is true of it.
    expandable: resolved.resolved && Boolean(resolved.doi),
    expanded: false,
  };
}

export function rootNode(seed: SeedRoot): GraphNode {
  return {
    id: seed.workKey,
    workKey: seed.workKey,
    label: seed.title,
    isRoot: true,
    doi: seed.doi,
    year: seed.year,
    resolved: true,
    expandable: false,
    expanded: true,
  };
}

/** Refs become nodes plus one link each, pointing in the direction of
 * citation: `citing` refs cite the root, the root cites `cited` refs. */
export function refsToGraph(
  rootId: string,
  refs: CitationRef[],
  kind: "citing" | "cited",
): GraphState {
  const nodes = refs.map(nodeFromRef);
  const links = nodes.map((node) => ({
    source: kind === "citing" ? node.id : rootId,
    target: kind === "citing" ? rootId : node.id,
    kind,
  }));
  return { nodes, links };
}

/**
 * Seeds a graph from one or many roots, taking references **round-robin** across
 * the seeds rather than draining them in order.
 *
 * With twenty roots and a 150-node budget, filling seed one's references before
 * touching seed two spends the whole budget on the first two papers — and the
 * entire point of the multi-root form is seeing that four of twenty results
 * cite the same 1998 paper. Interleaving gives every root a share, and shared
 * ancestors cost nothing extra because they dedupe.
 */
export function seedGraph(
  seeds: SeedRoot[],
  refsBySeed: Map<string, { citing: CitationRef[]; cited: CitationRef[] }>,
): GraphState {
  let state: GraphState = { nodes: seeds.map(rootNode), links: [] };

  // Both directions, flattened per seed, so one seed's turn contributes one
  // reference of either kind.
  const queues = seeds.map((seed) => {
    const refs = refsBySeed.get(seed.workKey);
    if (!refs) return [] as Array<{ ref: CitationRef; kind: "citing" | "cited" }>;
    return [
      ...refs.citing.map((ref) => ({ ref, kind: "citing" as const })),
      ...refs.cited.map((ref) => ({ ref, kind: "cited" as const })),
    ];
  });

  const cursors = new Array(seeds.length).fill(0);
  let exhausted = false;
  while (!exhausted && !atCapacity(state)) {
    exhausted = true;
    for (let i = 0; i < seeds.length && !atCapacity(state); i++) {
      const next = queues[i][cursors[i]];
      if (!next) continue;
      cursors[i] += 1;
      exhausted = false;
      state = mergeGraph(state, refsToGraph(seeds[i].workKey, [next.ref], next.kind));
    }
  }

  return state;
}

function linkKey(link: GraphLink): string {
  return `${endpointId(link.source)}->${endpointId(link.target)}`;
}

/**
 * Merges an expansion into the current graph, deduping nodes and links and
 * respecting the node budget.
 *
 * **Returns the original arrays by reference when nothing changed.** That is
 * not a micro-optimisation: `react-force-graph-2d` treats a new `graphData`
 * object as a changed graph and reheats the d3 simulation, so a rebuild that
 * produces equal-but-new arrays makes the nodes jitter forever. A test asserts
 * the identity directly.
 */
export function mergeGraph(current: GraphState, incoming: GraphState): GraphState {
  const existingNodeIds = new Set(current.nodes.map((n) => n.id));
  const capacity = Math.max(0, MAX_NODES - current.nodes.length);

  const newNodes: GraphNode[] = [];
  for (const node of incoming.nodes) {
    if (existingNodeIds.has(node.id)) continue;
    if (newNodes.length >= capacity) break;
    existingNodeIds.add(node.id);
    newNodes.push(node);
  }

  const existingLinkKeys = new Set(current.links.map(linkKey));
  const newLinks = incoming.links.filter((link) => {
    const key = linkKey(link);
    if (existingLinkKeys.has(key)) return false;
    // A link to a node the cap excluded would render as an edge into nothing.
    if (!existingNodeIds.has(endpointId(link.source))) return false;
    if (!existingNodeIds.has(endpointId(link.target))) return false;
    existingLinkKeys.add(key);
    return true;
  });

  if (newNodes.length === 0 && newLinks.length === 0) return current;

  return {
    nodes: newNodes.length > 0 ? [...current.nodes, ...newNodes] : current.nodes,
    links: newLinks.length > 0 ? [...current.links, ...newLinks] : current.links,
  };
}

/** Marks a node expanded, again preserving array identity when it is already
 * in that state. */
export function markExpanded(state: GraphState, nodeId: string): GraphState {
  const target = state.nodes.find((n) => n.id === nodeId);
  if (!target || target.expanded) return state;
  return {
    nodes: state.nodes.map((n) => (n.id === nodeId ? { ...n, expanded: true } : n)),
    links: state.links,
  };
}

export function atCapacity(state: GraphState): boolean {
  return state.nodes.length >= MAX_NODES;
}
