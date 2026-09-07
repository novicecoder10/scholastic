"use client";

import Link from "next/link";
import type { GraphNode } from "@/lib/graph/model";

/**
 * What a selected node is, and what can be done with it.
 *
 * The graph speaks the app's own work identity now, so every affordance the
 * rest of Scholastic has is available here with no new plumbing — and the
 * doi.org jump becomes an explicit link rather than the default click action,
 * which is what makes it possible to "just look".
 */
export function GraphInspector({
  node,
  inLibrary,
  inDegree,
  onExpand,
  onCollapse,
  onCite,
}: {
  node: GraphNode | null;
  inLibrary: boolean;
  inDegree: number | undefined;
  onExpand: () => void;
  onCollapse: () => void;
  onCite?: (workKey: string) => void;
}) {
  if (!node) {
    return (
      <aside className="border-line text-muted rounded-xl border p-3 text-xs">
        Select a paper to inspect it.
      </aside>
    );
  }

  return (
    <aside className="border-line space-y-3 rounded-xl border p-3 text-xs">
      <div>
        <p className="text-ink text-sm font-medium">{node.label}</p>
        <p className="text-muted mt-1">
          {node.year ?? "no year"}
          {inLibrary && " · in your library"}
          {node.isRoot && " · starting paper"}
        </p>
        {inDegree !== undefined && (
          <p className="text-muted">
            Cited by <span className="metric">{inDegree}</span> paper
            {inDegree === 1 ? "" : "s"} in this graph
          </p>
        )}
      </div>

      {!node.resolved && (
        <p className="text-muted">
          This reference has no DOI and didn&apos;t match anything indexed, so it can&apos;t be
          expanded or opened. It is still shown, because leaving it out would hide a real edge.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {node.expandable && !node.expanded && (
          <button
            type="button"
            onClick={onExpand}
            className="border-line text-muted hover:border-accent hover:text-accent rounded-full border px-2 py-1 transition-colors"
          >
            Expand
          </button>
        )}
        {node.expanded && !node.isRoot && (
          <button
            type="button"
            onClick={onCollapse}
            className="border-line text-muted hover:border-accent hover:text-accent rounded-full border px-2 py-1 transition-colors"
          >
            Collapse
          </button>
        )}
        {onCite && node.resolved && (
          <button
            type="button"
            onClick={() => onCite(node.workKey)}
            className="border-line text-muted hover:border-accent hover:text-accent rounded-full border px-2 py-1 transition-colors"
          >
            Cite
          </button>
        )}
        {node.doi && (
          <a
            href={`https://doi.org/${node.doi}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-link hover:underline"
          >
            Open paper ↗
          </a>
        )}
        {node.resolved && (
          <Link
            href={`/graph?work=${encodeURIComponent(node.workKey)}`}
            className="text-link hover:underline"
          >
            Explore from here
          </Link>
        )}
      </div>
    </aside>
  );
}
