import { describe, it, expect } from "vitest";
import {
  atCapacity,
  markExpanded,
  mergeGraph,
  refsToGraph,
  rootNode,
  seedGraph,
} from "@/lib/graph/build";
import { MAX_NODES, type CitationRef, type GraphState } from "@/lib/graph/model";

const ROOT = rootNode({ workKey: "doi:10.1/root", title: "Root", doi: "10.1/root", year: 2000 });

function ref(doi: string | null, title: string, year: number | null = 2010): CitationRef {
  return { doi, title, year };
}

describe("refsToGraph", () => {
  it("points citing refs at the root and the root at cited refs", () => {
    const citing = refsToGraph(ROOT.id, [ref("10.1/a", "A")], "citing");
    expect(citing.links[0]).toMatchObject({ source: "doi:10.1/a", target: ROOT.id });

    const cited = refsToGraph(ROOT.id, [ref("10.1/b", "B")], "cited");
    expect(cited.links[0]).toMatchObject({ source: ROOT.id, target: "doi:10.1/b" });
  });

  it("marks a DOI-less ref unresolved and not expandable", () => {
    const [node] = refsToGraph(ROOT.id, [ref(null, "No DOI here")], "cited").nodes;
    expect(node.resolved).toBe(false);
    expect(node.expandable).toBe(false);
    expect(node.id.startsWith("unresolved:")).toBe(true);
  });

  it("gives a DOI-less ref a stable id across rebuilds", () => {
    // Without this, every rebuild invents a new node for the same reference and
    // the graph grows copies of it.
    const once = refsToGraph(ROOT.id, [ref(null, "Same paper", 1998)], "cited").nodes[0].id;
    const twice = refsToGraph(ROOT.id, [ref(null, "Same paper", 1998)], "cited").nodes[0].id;
    expect(once).toBe(twice);
  });
});

describe("mergeGraph", () => {
  const base: GraphState = { nodes: [ROOT], links: [] };

  it("dedupes a node already present", () => {
    const once = mergeGraph(base, refsToGraph(ROOT.id, [ref("10.1/a", "A")], "citing"));
    const twice = mergeGraph(once, refsToGraph(ROOT.id, [ref("10.1/a", "A")], "citing"));
    expect(twice.nodes).toHaveLength(2);
  });

  it("returns the very same arrays when nothing changed", () => {
    // Not a micro-optimisation: react-force-graph-2d treats a new graphData
    // object as a changed graph and reheats the d3 simulation, so equal-but-new
    // arrays make the nodes jitter forever. This is the regression guard.
    const once = mergeGraph(base, refsToGraph(ROOT.id, [ref("10.1/a", "A")], "citing"));
    const twice = mergeGraph(once, refsToGraph(ROOT.id, [ref("10.1/a", "A")], "citing"));
    expect(twice).toBe(once);
    expect(twice.nodes).toBe(once.nodes);
    expect(twice.links).toBe(once.links);
  });

  it("respects the node cap", () => {
    const many = Array.from({ length: MAX_NODES + 50 }, (_, i) => ref(`10.1/${i}`, `Paper ${i}`));
    const merged = mergeGraph(base, refsToGraph(ROOT.id, many, "citing"));
    expect(merged.nodes).toHaveLength(MAX_NODES);
    expect(atCapacity(merged)).toBe(true);
  });

  it("drops a link whose endpoint the cap excluded", () => {
    // An edge into a node that is not there renders as a line to nowhere.
    const many = Array.from({ length: MAX_NODES + 10 }, (_, i) => ref(`10.1/${i}`, `Paper ${i}`));
    const merged = mergeGraph(base, refsToGraph(ROOT.id, many, "citing"));
    const ids = new Set(merged.nodes.map((n) => n.id));
    for (const link of merged.links) {
      expect(ids.has(typeof link.source === "string" ? link.source : link.source.id)).toBe(true);
      expect(ids.has(typeof link.target === "string" ? link.target : link.target.id)).toBe(true);
    }
  });

  it("dedupes an identical link", () => {
    const incoming = refsToGraph(ROOT.id, [ref("10.1/a", "A")], "citing");
    const once = mergeGraph(base, incoming);
    const merged = mergeGraph(once, { nodes: [], links: incoming.links });
    expect(merged.links).toHaveLength(1);
  });
});

describe("markExpanded", () => {
  it("flags the node and leaves the links untouched", () => {
    const state = mergeGraph(
      { nodes: [ROOT], links: [] },
      refsToGraph(ROOT.id, [ref("10.1/a", "A")], "citing"),
    );
    const next = markExpanded(state, "doi:10.1/a");
    expect(next.nodes.find((n) => n.id === "doi:10.1/a")?.expanded).toBe(true);
    expect(next.links).toBe(state.links);
  });

  it("returns the same state when the node is already expanded", () => {
    const state: GraphState = { nodes: [ROOT], links: [] };
    expect(markExpanded(state, ROOT.id)).toBe(state);
  });

  it("returns the same state for an unknown node", () => {
    const state: GraphState = { nodes: [ROOT], links: [] };
    expect(markExpanded(state, "doi:nope")).toBe(state);
  });
});

describe("seedGraph", () => {
  const seeds = [
    { workKey: "doi:10.1/one", title: "One", doi: "10.1/one", year: 2001 },
    { workKey: "doi:10.1/two", title: "Two", doi: "10.1/two", year: 2002 },
  ];

  it("keeps every root", () => {
    const state = seedGraph(seeds, new Map());
    expect(state.nodes.map((n) => n.id)).toEqual(["doi:10.1/one", "doi:10.1/two"]);
    expect(state.nodes.every((n) => n.isRoot)).toBe(true);
  });

  it("draws an edge between roots that cite the same paper", () => {
    // The whole point of the multi-root form.
    const shared = ref("10.1/ancestor", "Ancestor", 1998);
    const state = seedGraph(
      seeds,
      new Map([
        ["doi:10.1/one", { citing: [], cited: [shared] }],
        ["doi:10.1/two", { citing: [], cited: [shared] }],
      ]),
    );
    expect(state.nodes).toHaveLength(3);
    expect(state.links).toHaveLength(2);
  });

  it("shares the budget across seeds instead of draining the first", () => {
    // Filling seed one's references before touching seed two spends the whole
    // budget on one paper, which defeats the multi-root form entirely.
    const many = (prefix: string) =>
      Array.from({ length: MAX_NODES }, (_, i) => ref(`10.1/${prefix}${i}`, `${prefix} ${i}`));
    const state = seedGraph(
      seeds,
      new Map([
        ["doi:10.1/one", { citing: many("a"), cited: [] }],
        ["doi:10.1/two", { citing: many("b"), cited: [] }],
      ]),
    );
    const fromOne = state.nodes.filter((n) => n.id.includes("/a")).length;
    const fromTwo = state.nodes.filter((n) => n.id.includes("/b")).length;
    expect(state.nodes).toHaveLength(MAX_NODES);
    expect(fromOne).toBeGreaterThan(0);
    expect(fromTwo).toBeGreaterThan(0);
    // Within one of each other, since they take turns.
    expect(Math.abs(fromOne - fromTwo)).toBeLessThanOrEqual(1);
  });

  it("terminates when one seed has far more references than the other", () => {
    const state = seedGraph(
      seeds,
      new Map([
        ["doi:10.1/one", { citing: [ref("10.1/a", "A")], cited: [] }],
        ["doi:10.1/two", { citing: [ref("10.1/b", "B"), ref("10.1/c", "C")], cited: [] }],
      ]),
    );
    expect(state.nodes).toHaveLength(5);
  });
});
