# Citation Graph Explorer — Design

Date: 2026-09-06
Sub-project: #9 of 9
Depends on: #5 (collections, library markers), #8 (cite-into-manuscript action)
Status: approved, not implemented

## What this is

The citation graph today is a 520px canvas inside one result card's
`<details>`, seeded from one paper, expanded by right-clicking a node. It
works, and it is a curiosity rather than a research tool.

This sub-project promotes it to a first-class explorer, unifies its node
identity with the rest of the app, and adds deterministic structural analysis.

### Decisions taken before design (2026-09-06)

1. **Scope** — promote to a full-page explorer, keeping the per-card graph as
   the discovery entry point.
2. **Identity** — resolve nodes to the app's own `getWorkKey()`.
3. **Analysis** — deterministic graph algorithms, no LLM narration.

## The refactor is the feature

`src/lib/graph/` exists and is empty. All logic lives inside
`CitationGraph.tsx` (317 lines), so none of it is testable. That is inverted
before anything is added:

| Module | Contents |
| --- | --- |
| `lib/graph/model.ts` | `GraphNode`, `GraphLink`, `GraphState`. No React. |
| `lib/graph/build.ts` | Refs to nodes/links, dedupe, capping, merge on expand |
| `lib/graph/analysis.ts` | Components, in-degree, shortest path, year layering |
| `lib/graph/filter.ts` | Year range, minimum degree, collapse, hide unresolved |
| `lib/graph/identity.ts` | Citation ref to `workKey`, with the unresolved path |

`CitationGraph.tsx` becomes a renderer over those modules. Every behaviour
above is then covered by node-environment vitest, which is the only reason the
rest of this spec is safe to attempt.

### One thing the refactor must preserve

The `graphData` memo, and its comment explaining that `react-force-graph-2d`
treats a new object literal as a changed graph and reheats the d3 simulation
forever. That is a hard-won fix. `build.ts` must return referentially stable
arrays when nothing changed, and a test asserts it.

## Node identity

`nodeIdFor()` is removed. Nodes carry a `workKey`, the same identity the rest
of the app uses.

```ts
// lib/graph/identity.ts
export interface ResolvedRef {
  workKey: string;
  resolved: boolean;   // false => provisional, not expandable
  doi: string | null;
  title: string | null;
  year: number | null;
}

export function resolveRef(ref: CitationRef): ResolvedRef;
```

Resolution order:

1. **DOI present** — `getWorkKey({ doi })` is `doi:<normalized>` with no lookup
   at all. Most citation refs have a DOI, so the feared per-node lookup cost
   largely does not exist.
2. **No DOI** — match against the `work` table via `lib/merge/matcher.ts` on
   title and year.
3. **No match** — `unresolved:<sha256(title|year)>`, with `resolved: false`.

One id shape carrying a flag, not two id shapes. Unresolved nodes render dimmed
and are not expandable — as today — but now the inspector says why.

### What this unlocks

Because the graph finally speaks the app's identity:

- A node already in the user's library gets a marker.
- The inspector offers Save, Cite into a manuscript (#8), Chat, and Summarize —
  every affordance the rest of the app already has, with no new plumbing.
- A graph seeded from a #5 collection knows which of its nodes are the
  collection.

## Interaction

Right-click to expand is undiscoverable and impossible on touch. The tell is
that the component currently explains it in a paragraph of prose.

| Gesture | Effect |
| --- | --- |
| Click / tap | Select node, open inspector |
| Double-click, or Enter on selection | Expand that node's citations |
| Escape | Deselect |
| Arrow keys | Move selection along edges |
| Hover | Highlight connections (unchanged) |
| Click an edge | Citation reasoning (unchanged) |

The doi.org jump moves into the inspector as an explicit link rather than being
the default click action. This fixes what the existing hover comment already
concedes: *"clicking a node navigates away to the paper's page rather than
being available to 'just look.'"*

### Accessibility

The canvas gets a focusable wrapper and an accessible fallback list of nodes
and edges rendered in the DOM. A `<canvas>` graph is otherwise completely
invisible to a screen reader, and this app already does this work elsewhere
(native `<details>` disclosures, sr-only labels, `aria-live` regions).

### The cap becomes a budget

Today, reaching 150 nodes prints "expand a different branch" with no mechanism
for doing so. Added:

- **Collapse a node** — removes descendants reachable only through it.
- **Filter** by year range, by minimum in-degree, and hide unresolved nodes.
- The counter shows nodes used against the cap, continuously.

## Multi-root

`/graph` is a real page, seeded three ways:

| URL | Seed |
| --- | --- |
| `/graph?work=<workKey>` | One paper — what the card graph does today |
| `/graph?collection=<publicId>` | A #5 collection |
| `/graph?from=search&q=<query>` | The current result set |

Edges are drawn between roots wherever citation data connects them. That is the
actual value of the multi-root form: seeing that four of twenty results all
cite the same 1998 paper.

The per-card `CitationGraphSection` stays, gaining an "Open in explorer" link.
It is how anyone discovers the graph exists.

## Analysis

All pure, all deterministic, no LLM, no metered cost.

```ts
// lib/graph/analysis.ts
export function connectedComponents(g: Graph): string[][];
export function inDegreeWithinSet(g: Graph): Map<string, number>;
export function shortestCitationPath(g: Graph, from: string, to: string): string[] | null;
export function yearLayers(g: Graph): Map<string, number>;
```

- **Components and clustering** over the undirected projection.
- **In-degree within the loaded set** — "most cited in this literature" is a
  different and frequently more useful number than a global citation count.
- **Shortest citation path** between two selected nodes, following edge
  direction, surfacing intellectual lineage.
- **Year-layered layout** with x mapped to year, which makes lineage legible in
  a way a force layout never does. Nodes with no year sit in a separate lane
  rather than being dropped.

### The honesty constraint

Citation coverage is incomplete and biased: OpenAlex, Crossref and Semantic
Scholar all have gaps, and preprints and non-English work are systematically
under-linked.

**Every computed metric is labelled "within the loaded subgraph"** wherever it
appears. None of these numbers is presented as a property of the literature.

This is also why LLM narration of clusters is rejected. A generated paragraph
explaining what a cluster "represents" launders incomplete data into confident
prose. Edge-level citation reasoning stays — it already exists and is grounded
in two specific named papers. Set-level narration is not the same thing and
does not get added.

## Testing

Node-environment vitest over `lib/graph/`, which is the point of the refactor.

`build.ts`:

- Dedupe across successive expansions.
- Cap respected; links retained only when both endpoints exist.
- A DOI-less ref receives a stable `unresolved:` id across rebuilds.
- **Rebuilding with identical input returns the same array references** —
  guards the d3 reheat regression directly.

`analysis.ts`:

- Components on a known fixture graph.
- In-degree within the set differs from the global citation count.
- Shortest path, including the no-path case and a cycle.
- Year layering with missing years.

`filter.ts`:

- Year range and minimum in-degree.
- Collapse removes only descendants reachable exclusively through the collapsed
  node — a node with another parent survives.

`identity.ts`:

- DOI path requires no lookup.
- Title/year match against the work table.
- Unresolved hash is stable and marked `resolved: false`.

Canvas interaction and keyboard navigation are covered by the Playwright suite
introduced at #5.

## Non-goals

- LLM narration of clusters or of the graph as a whole.
- Co-authorship, venue, and concept graphs. A different product.
- Saved or shareable graph views.
- Server-side graph computation, or graphs beyond the node cap.
- Bibliometric indices (h-index and relatives).

## New configuration

None. No new dependencies — `react-force-graph-2d` is already installed.
