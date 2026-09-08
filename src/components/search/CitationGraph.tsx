"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { GraphInspector } from "@/components/graph/GraphInspector";
import { GraphControls } from "@/components/graph/GraphControls";
import { GraphFallbackList } from "@/components/graph/GraphFallbackList";
import { markExpanded, mergeGraph, refsToGraph } from "@/lib/graph/build";
import { inDegreeWithinSet, summarise } from "@/lib/graph/analysis";
import {
  applyGraphFilters,
  collapseNode,
  EMPTY_GRAPH_FILTERS,
  type GraphFilters,
} from "@/lib/graph/filter";
import {
  endpointId,
  MAX_NODES,
  type GraphLink,
  type GraphNode,
  type GraphState,
} from "@/lib/graph/model";

// Canvas-based force-directed graph — touches `window` at load, must never
// run during SSR.
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

type ReasoningState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "success"; text: string }
  | { status: "error" };

/**
 * A renderer over `lib/graph/*`. Every rule it used to own — identity, merging,
 * capping, filtering, analysis — now lives in pure modules with tests, which is
 * what made the rest of #9 safe to build.
 */
export function CitationGraph({
  initialState,
  height = 520,
  libraryKeys,
  onCite,
}: {
  initialState: GraphState;
  height?: number;
  /** workKeys already in the viewer's library, so a node can be marked. */
  libraryKeys?: Set<string>;
  /** Provided by the explorer page when a manuscript is open. */
  onCite?: (workKey: string) => void;
}) {
  const [state, setState] = useState<GraphState>(initialState);
  const [filters, setFilters] = useState<GraphFilters>(EMPTY_GRAPH_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadingNodeId, setLoadingNodeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reasoning, setReasoning] = useState<ReasoningState>({ status: "idle" });
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null);
  const lastClick = useRef<{ id: string; at: number } | null>(null);

  const visible = useMemo(() => applyGraphFilters(state, filters), [state, filters]);

  /**
   * Critical: react-force-graph-2d treats a *new* graphData object as "the
   * graph changed" and reheats the d3 simulation, so an inline object literal
   * makes the nodes jitter forever whenever unrelated state changes. Memoising
   * on the array references fixes it — and `mergeGraph` returns the same arrays
   * when nothing changed, which is asserted by a test rather than assumed.
   */
  const graphData = useMemo(
    () => ({ nodes: visible.nodes, links: visible.links }),
    [visible.nodes, visible.links],
  );

  const summary = useMemo(() => summarise(visible), [visible]);
  const inDegree = useMemo(() => inDegreeWithinSet(visible), [visible]);

  // react-force-graph-2d doesn't auto-size to its container.
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(400);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const selected = useMemo(
    () => visible.nodes.find((n) => n.id === selectedId) ?? null,
    [visible.nodes, selectedId],
  );

  const expand = useCallback(
    async (node: GraphNode) => {
      if (node.expanded || !node.expandable || !node.doi) return;
      if (state.nodes.length >= MAX_NODES) {
        setError(
          `Graph is at its ${MAX_NODES}-node budget. Collapse a branch or narrow the filters, then expand again.`,
        );
        return;
      }

      setLoadingNodeId(node.id);
      setError(null);
      try {
        const response = await fetch(`/api/citations/by-doi?doi=${encodeURIComponent(node.doi)}`);
        if (!response.ok) {
          setError("Couldn't load citations for that paper.");
          return;
        }
        const body = (await response.json()) as {
          citing: Array<{ doi: string | null; title: string | null; year: number | null }>;
          cited: Array<{ doi: string | null; title: string | null; year: number | null }>;
        };
        setState((current) => {
          let next = mergeGraph(current, refsToGraph(node.id, body.citing, "citing"));
          next = mergeGraph(next, refsToGraph(node.id, body.cited, "cited"));
          return markExpanded(next, node.id);
        });
      } catch {
        setError("Couldn't load citations for that paper.");
      } finally {
        setLoadingNodeId(null);
      }
    },
    [state.nodes.length],
  );

  const neighbourIds = useMemo(() => {
    if (!hoverNodeId) return null;
    const ids = new Set<string>([hoverNodeId]);
    for (const link of visible.links) {
      const source = endpointId(link.source);
      const target = endpointId(link.target);
      if (source === hoverNodeId) ids.add(target);
      if (target === hoverNodeId) ids.add(source);
    }
    return ids;
  }, [hoverNodeId, visible.links]);

  const isLinkHovered = useCallback(
    (link: GraphLink) =>
      Boolean(hoverNodeId) &&
      (endpointId(link.source) === hoverNodeId || endpointId(link.target) === hoverNodeId),
    [hoverNodeId],
  );

  const explainEdge = useCallback(
    async (link: GraphLink) => {
      const citing = visible.nodes.find((n) => n.id === endpointId(link.source));
      const cited = visible.nodes.find((n) => n.id === endpointId(link.target));
      if (!citing?.doi || !cited?.doi) return setReasoning({ status: "unavailable" });

      setReasoning({ status: "loading" });
      try {
        const response = await fetch("/api/citations/reasoning", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ citingDoi: citing.doi, citedDoi: cited.doi }),
        });
        if (response.status === 503) return setReasoning({ status: "unavailable" });
        if (!response.ok) return setReasoning({ status: "error" });
        const body = (await response.json()) as { reasoning: string };
        setReasoning({ status: "success", text: body.reasoning });
      } catch {
        setReasoning({ status: "error" });
      }
    },
    [visible.nodes],
  );

  /** Arrow keys walk the edges from the selection, so the graph is navigable
   * without a pointer at all. */
  const step = useCallback(
    (direction: 1 | -1) => {
      const ids = visible.nodes.map((n) => n.id);
      if (ids.length === 0) return;
      if (!selectedId) return setSelectedId(ids[0]);
      const neighbours: string[] = [];
      for (const link of visible.links) {
        const source = endpointId(link.source);
        const target = endpointId(link.target);
        if (source === selectedId) neighbours.push(target);
        if (target === selectedId) neighbours.push(source);
      }
      const pool = neighbours.length > 0 ? neighbours : ids;
      const current = pool.indexOf(selectedId);
      setSelectedId(pool[(current + direction + pool.length) % pool.length]);
    },
    [visible, selectedId],
  );

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") return setSelectedId(null);
    if (event.key === "Enter" && selected) {
      event.preventDefault();
      void expand(selected);
      return;
    }
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      step(1);
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      step(-1);
    }
  }

  return (
    <div>
      <GraphControls
        filters={filters}
        onChange={setFilters}
        summary={summary}
        nodeCap={MAX_NODES}
        totalNodes={state.nodes.length}
      />

      {error && (
        <p className="text-danger mb-1 text-xs" role="alert">
          {error}
        </p>
      )}
      {loadingNodeId && <p className="text-muted mb-1 text-xs">Loading…</p>}

      <p className="text-muted mb-2 text-xs">
        Click a node to inspect it. Double-click, or press Enter with it selected, to expand its
        citations. Arrow keys follow edges; Escape deselects. Click an edge to ask why that citation
        exists.
      </p>

      <div className="flex flex-col gap-4 lg:flex-row">
        <div
          ref={containerRef}
          tabIndex={0}
          role="application"
          aria-label="Citation graph. Use arrow keys to move between papers and Enter to expand one."
          onKeyDown={onKeyDown}
          className="border-line bg-page focus-visible:border-accent min-w-0 flex-1 overflow-hidden rounded-xl border outline-none"
          style={{ height }}
        >
          <ForceGraph2D
            graphData={graphData}
            nodeId="id"
            nodeLabel="label"
            nodeColor={(n: object) => {
              const node = n as GraphNode;
              if (node.id === selectedId) return "#f472b6";
              if (neighbourIds && !neighbourIds.has(node.id)) return "#3a4152";
              if (!node.resolved) return "#4b5262";
              if (libraryKeys?.has(node.workKey)) return "#34d399";
              return node.isRoot ? "#818cf8" : "#8b93a3";
            }}
            nodeRelSize={6}
            linkWidth={(l: object) => (isLinkHovered(l as GraphLink) ? 3 : 1.5)}
            linkDirectionalArrowLength={5}
            linkColor={(l: object) => (isLinkHovered(l as GraphLink) ? "#818cf8" : "#8b93a380")}
            linkHoverPrecision={8}
            onNodeHover={(n: object | null) => setHoverNodeId(n ? (n as GraphNode).id : null)}
            // Click selects rather than navigating away: the old behaviour made
            // it impossible to "just look", which the component's own comment
            // used to concede. The doi.org jump is now a link in the inspector.
            //
            // Double-click expands. react-force-graph-2d has no double-click
            // callback, so it is detected here — right-click alone was
            // undiscoverable and impossible on touch, which is why the component
            // used to need a paragraph of prose explaining it.
            onNodeClick={(n: object) => {
              const node = n as GraphNode;
              const previous = lastClick.current;
              lastClick.current = { id: node.id, at: Date.now() };
              setSelectedId(node.id);
              if (previous && previous.id === node.id && Date.now() - previous.at < 400) {
                void expand(node);
              }
            }}
            onNodeRightClick={(n: object) => expand(n as GraphNode)}
            onLinkClick={(l: object) => explainEdge(l as GraphLink)}
            width={width}
            height={height}
          />
        </div>

        <div className="w-full shrink-0 lg:w-72">
          <GraphInspector
            node={selected}
            inLibrary={selected ? Boolean(libraryKeys?.has(selected.workKey)) : false}
            inDegree={selected ? (inDegree.get(selected.id) ?? 0) : undefined}
            onExpand={() => selected && void expand(selected)}
            onCollapse={() => selected && setState((current) => collapseNode(current, selected.id))}
            onCite={onCite}
          />
        </div>
      </div>

      {reasoning.status === "loading" && (
        <p className="text-muted mt-2 text-xs">Thinking about why…</p>
      )}
      {reasoning.status === "unavailable" && (
        <p className="text-muted mt-2 text-xs">
          Citation reasoning isn&apos;t available for this edge — a DOI, or a configured AI
          provider, is missing.
        </p>
      )}
      {reasoning.status === "error" && (
        <p className="text-danger mt-2 text-xs">Couldn&apos;t generate an explanation.</p>
      )}
      {reasoning.status === "success" && (
        <p className="border-accent/25 bg-surface-2 text-ink mt-2 rounded-xl border p-3 text-sm">
          {reasoning.text}
        </p>
      )}

      <GraphFallbackList state={visible} onSelect={setSelectedId} onExpand={expand} />
    </div>
  );
}
