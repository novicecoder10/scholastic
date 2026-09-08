import { describe, it, expect } from "vitest";
import {
  connectedComponents,
  inDegreeWithinSet,
  shortestCitationPath,
  summarise,
  yearLayers,
} from "@/lib/graph/analysis";
import type { GraphNode, GraphState } from "@/lib/graph/model";

function node(id: string, year: number | null = 2010, resolved = true): GraphNode {
  return {
    id,
    workKey: id,
    label: id,
    isRoot: false,
    doi: null,
    year,
    resolved,
    expandable: false,
    expanded: false,
  };
}

/** a → b → c, plus an isolated pair d → e. "→" is "cites". */
const GRAPH: GraphState = {
  nodes: [node("a", 2020), node("b", 2010), node("c", 2000), node("d", 2015), node("e", 2005)],
  links: [
    { source: "a", target: "b", kind: "cited" },
    { source: "b", target: "c", kind: "cited" },
    { source: "d", target: "e", kind: "cited" },
  ],
};

describe("connectedComponents", () => {
  it("finds components over the undirected projection", () => {
    // Two papers in the same conversation are connected whichever way the
    // citation runs.
    expect(connectedComponents(GRAPH)).toEqual([
      ["a", "b", "c"],
      ["d", "e"],
    ]);
  });

  it("counts an isolated node as its own component", () => {
    const withLoner = { nodes: [...GRAPH.nodes, node("z")], links: GRAPH.links };
    expect(connectedComponents(withLoner)).toHaveLength(3);
  });

  it("handles an empty graph", () => {
    expect(connectedComponents({ nodes: [], links: [] })).toEqual([]);
  });
});

describe("inDegreeWithinSet", () => {
  it("counts citations from inside the loaded graph only", () => {
    // The point of the metric: a paper cited 40,000 times worldwide that
    // nothing here cites is peripheral to this question.
    const degrees = inDegreeWithinSet(GRAPH);
    expect(degrees.get("b")).toBe(1);
    expect(degrees.get("c")).toBe(1);
    expect(degrees.get("a")).toBe(0);
  });

  it("ignores a link whose endpoint is not a node", () => {
    const dangling: GraphState = {
      nodes: [node("a")],
      links: [{ source: "a", target: "ghost", kind: "cited" }],
    };
    expect(inDegreeWithinSet(dangling).get("a")).toBe(0);
  });
});

describe("shortestCitationPath", () => {
  it("follows citation direction, which is what makes it lineage", () => {
    expect(shortestCitationPath(GRAPH, "a", "c")).toEqual(["a", "b", "c"]);
  });

  it("returns null against the direction of citation", () => {
    // c does not reach a: ideas travel forwards, citations point back.
    expect(shortestCitationPath(GRAPH, "c", "a")).toBeNull();
  });

  it("returns null when the two nodes are in different components", () => {
    expect(shortestCitationPath(GRAPH, "a", "e")).toBeNull();
  });

  it("returns a single-node path from a node to itself", () => {
    expect(shortestCitationPath(GRAPH, "a", "a")).toEqual(["a"]);
  });

  it("terminates on a cycle", () => {
    const cyclic: GraphState = {
      nodes: [node("x"), node("y")],
      links: [
        { source: "x", target: "y", kind: "cited" },
        { source: "y", target: "x", kind: "cited" },
      ],
    };
    expect(shortestCitationPath(cyclic, "x", "y")).toEqual(["x", "y"]);
  });

  it("returns null for an unknown node", () => {
    expect(shortestCitationPath(GRAPH, "a", "nope")).toBeNull();
  });
});

describe("yearLayers", () => {
  it("layers from the earliest year present", () => {
    const layers = yearLayers(GRAPH);
    expect(layers.get("c")).toBe(0);
    expect(layers.get("a")).toBe(20);
  });

  it("puts a node with no year in its own lane rather than dropping it", () => {
    // Dropping them would hide exactly the preprints and non-English work the
    // coverage caveat is about.
    const layers = yearLayers({ nodes: [node("u", null)], links: [] });
    expect(layers.get("u")).toBe(-1);
  });
});

describe("summarise", () => {
  it("reports counts and the most-cited node within the set", () => {
    const summary = summarise(GRAPH);
    expect(summary).toMatchObject({
      nodeCount: 5,
      linkCount: 3,
      componentCount: 2,
      largestComponent: 3,
    });
    expect(summary.mostCited?.inDegree).toBe(1);
  });

  it("has no most-cited node when nothing is cited", () => {
    expect(summarise({ nodes: [node("a")], links: [] }).mostCited).toBeNull();
  });

  it("counts unresolved nodes", () => {
    const state = { nodes: [node("a"), node("u", 2010, false)], links: [] };
    expect(summarise(state).unresolvedCount).toBe(1);
  });
});
