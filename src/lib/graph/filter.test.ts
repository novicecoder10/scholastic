import { describe, it, expect } from "vitest";
import { applyGraphFilters, collapseNode, EMPTY_GRAPH_FILTERS } from "@/lib/graph/filter";
import type { GraphNode, GraphState } from "@/lib/graph/model";

function node(id: string, overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    workKey: id,
    label: id,
    isRoot: false,
    doi: null,
    year: 2010,
    resolved: true,
    expandable: false,
    expanded: false,
    ...overrides,
  };
}

describe("applyGraphFilters", () => {
  const state: GraphState = {
    nodes: [
      node("root", { isRoot: true, year: 1990 }),
      node("old", { year: 1995 }),
      node("new", { year: 2020 }),
      node("undated", { year: null }),
      node("ghost", { resolved: false }),
    ],
    links: [
      { source: "old", target: "root", kind: "citing" },
      { source: "new", target: "root", kind: "citing" },
    ],
  };

  it("returns the same state when no filter is set", () => {
    expect(applyGraphFilters(state, EMPTY_GRAPH_FILTERS)).toBe(state);
  });

  it("filters by year range", () => {
    const filtered = applyGraphFilters(state, { ...EMPTY_GRAPH_FILTERS, yearFrom: 2000 });
    expect(filtered.nodes.map((n) => n.id)).not.toContain("old");
    expect(filtered.nodes.map((n) => n.id)).toContain("new");
  });

  it("keeps a node with no year through a year filter", () => {
    // Missing metadata is not evidence of a date outside the range.
    const filtered = applyGraphFilters(state, { ...EMPTY_GRAPH_FILTERS, yearFrom: 2000 });
    expect(filtered.nodes.map((n) => n.id)).toContain("undated");
  });

  it("always keeps roots", () => {
    // A filter that hides the paper you started from looks broken.
    const filtered = applyGraphFilters(state, { ...EMPTY_GRAPH_FILTERS, yearFrom: 2100 });
    expect(filtered.nodes.map((n) => n.id)).toContain("root");
  });

  it("hides unresolved nodes on request", () => {
    const filtered = applyGraphFilters(state, { ...EMPTY_GRAPH_FILTERS, hideUnresolved: true });
    expect(filtered.nodes.map((n) => n.id)).not.toContain("ghost");
  });

  it("filters by minimum in-degree within the set", () => {
    const filtered = applyGraphFilters(state, { ...EMPTY_GRAPH_FILTERS, minInDegree: 1 });
    // Only the root is cited here, and roots always survive anyway.
    expect(filtered.nodes.map((n) => n.id)).toEqual(["root"]);
  });

  it("drops links whose endpoints were filtered out", () => {
    const filtered = applyGraphFilters(state, { ...EMPTY_GRAPH_FILTERS, yearFrom: 2000 });
    expect(filtered.links).toHaveLength(1);
  });
});

describe("collapseNode", () => {
  it("removes descendants reachable only through the collapsed node", () => {
    const state: GraphState = {
      nodes: [node("root", { isRoot: true }), node("branch"), node("leaf")],
      links: [
        { source: "branch", target: "root", kind: "citing" },
        { source: "leaf", target: "branch", kind: "citing" },
      ],
    };
    const collapsed = collapseNode(state, "branch");
    expect(collapsed.nodes.map((n) => n.id)).toEqual(["root", "branch"]);
  });

  it("keeps a descendant that has another parent", () => {
    // The "only" is the whole substance: removing a node reachable another way
    // would silently delete a connection the user never asked to lose.
    const state: GraphState = {
      nodes: [node("root", { isRoot: true }), node("branch"), node("other"), node("shared")],
      links: [
        { source: "branch", target: "root", kind: "citing" },
        { source: "other", target: "root", kind: "citing" },
        { source: "shared", target: "branch", kind: "citing" },
        { source: "shared", target: "other", kind: "citing" },
      ],
    };
    const collapsed = collapseNode(state, "branch");
    expect(collapsed.nodes.map((n) => n.id)).toContain("shared");
  });

  it("clears the expanded flag even when nothing was removed", () => {
    const state: GraphState = {
      nodes: [node("root", { isRoot: true }), node("branch", { expanded: true })],
      links: [{ source: "branch", target: "root", kind: "citing" }],
    };
    const collapsed = collapseNode(state, "branch");
    expect(collapsed.nodes.find((n) => n.id === "branch")?.expanded).toBe(false);
  });
});
