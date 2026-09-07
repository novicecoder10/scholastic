"use client";

import { endpointId, type GraphNode, type GraphState } from "@/lib/graph/model";

/**
 * A `<canvas>` graph is completely invisible to a screen reader, so the same
 * nodes and edges are rendered as real DOM inside a disclosure.
 *
 * A native `<details>` for the same reason the rest of this app uses them: it
 * is keyboard-operable and announced correctly with no ARIA of our own.
 */
export function GraphFallbackList({
  state,
  onSelect,
  onExpand,
}: {
  state: GraphState;
  onSelect: (id: string) => void;
  onExpand: (node: GraphNode) => void;
}) {
  const byId = new Map(state.nodes.map((n) => [n.id, n]));

  return (
    <details className="border-line mt-3 rounded-xl border">
      <summary className="text-muted cursor-pointer px-3 py-2 text-xs">
        Papers and citations as a list ({state.nodes.length} papers, {state.links.length} edges)
      </summary>
      <div className="px-3 pb-3">
        <ul className="divide-line divide-y">
          {state.nodes.map((node) => (
            <li key={node.id} className="flex flex-wrap items-baseline gap-2 py-1.5 text-xs">
              <button
                type="button"
                onClick={() => onSelect(node.id)}
                className="text-ink hover:text-accent min-w-0 flex-1 text-left"
              >
                {node.label}
              </button>
              <span className="text-muted">{node.year ?? "no year"}</span>
              {node.expandable && !node.expanded && (
                <button
                  type="button"
                  onClick={() => onExpand(node)}
                  className="text-link hover:underline"
                >
                  Expand
                </button>
              )}
            </li>
          ))}
        </ul>

        <h3 className="text-muted mt-3 mb-1 text-xs">Citations</h3>
        <ul className="text-muted space-y-1 text-xs">
          {state.links.map((link, index) => {
            const from = byId.get(endpointId(link.source));
            const to = byId.get(endpointId(link.target));
            return (
              <li key={index}>
                {from?.label ?? "?"} cites {to?.label ?? "?"}
              </li>
            );
          })}
        </ul>
      </div>
    </details>
  );
}
