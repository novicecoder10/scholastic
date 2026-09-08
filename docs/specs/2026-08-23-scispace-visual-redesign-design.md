# Scholastic visual redesign (SciSpace-inspired) — Design

## Context

Scholastic's current UI is a light-mode, Tailwind-default-styled Next.js app
with no persistent navigation — the homepage is a centered search hero, and
there is no link anywhere to the existing `/health` page. The user wants a
visual overhaul inspired by [SciSpace](https://scispace.com/): dark theme,
card-based AI-summary treatment, persistent top nav.

This is sub-project **1 of 9** in a larger plan to bring Scholastic toward a
SciSpace-like product surface, gamified around a non-monetary credits system
(earned by publishing in indexed venues, completing peer reviews, etc. — no
paid tiers). The user supplied SciSpace's full feature set (Agent Gallery,
Templates library, Chat with PDF, AI Writer, Find Topics, Paraphraser,
Citation Generator, Extract Data, AI Detector) as a reference for "clone
every feature" — three of those (Agent Gallery: 2,602 items; Templates:
5,405 items; AI Detector's claimed benchmarked accuracy over GPTZero/
Grammarly) are platform-scale or not honestly buildable, and are **deferred
indefinitely** by explicit decision rather than sequenced in. Everything
else is folded into the sequence below, in dependency order:

1. **Visual redesign** (this spec) — restyle existing pages/components, add
   persistent nav shell + chat/task-first homepage. No new data, no new
   pages with real functionality.
2. File-upload infrastructure (new, small, foundational) — PDF upload/
   parsing capability that #3 and #7 both need; not user-facing on its own.
3. Chat with PDF (uses #2) — upload a paper directly and chat with it,
   rather than only chatting off search-result abstracts.
4. Quick-win tools batch — Citation Generator, Find Topics, Paraphraser
   (standalone, no dependencies on each other or on accounts).
5. Library / workspace + accounts — the persistence + identity layer
   gamification needs (Scholastic currently has none).
6. Gamification mechanics (credits/points, earned via research actions) —
   built on #5.
7. Extract Data (uses #2, PDF table/stat extraction — heavier effort,
   sequenced after the core experience is solid).
8. AI Writer — biggest new subsystem (rich-text editor + auto-citation);
   reuses #4's citation generator, benefits from #5's library.
9. Citation graph explorer enhancements.

Each of 2–9 gets its own brainstorming round and spec when its turn comes.
This spec covers **only** #1.

## Goals

- Restyle the existing app to a SciSpace-inspired dark, card-based aesthetic.
- Add a persistent top navbar and a chat/task-first homepage as the
  structural home for future pages/tools.
- Feel distinct from SciSpace despite the shared color family and layout
  pattern — differentiation comes from typography, spacing, and interaction
  detail, not from picking a different palette (see Palette below; the user
  explicitly chose to keep blue/indigo and differentiate elsewhere after
  reviewing the alternative-palette mockups).
- Change **zero** application logic, data flow, or API behavior for
  already-working features — this is a presentation-layer-only pass. (The
  homepage's quick-action buttons are new UI surface, but only one of them,
  `Search Papers`, wires to real behavior — see Homepage below.)

## Non-goals

- No new pages with real functionality beyond what's specified below.
  `Library` and the homepage's `Draft`/`Diagrams`/`Presentation` buttons are
  visible-but-disabled placeholders only.
- No accounts, persistence, or gamification UI — those are later sub-projects.
- No pixel-identical clone of SciSpace's actual brand colors (see palette
  rationale below) — the interaction patterns and layout are the same, the
  palette is original.
- No PDF upload, Chat-with-PDF, Citation Generator, Find Topics, Paraphraser,
  Extract Data, AI Writer, or citation-graph work — those are sub-projects
  2–9 above, each getting its own spec.

## Palette

Dark-first (light mode kept as the secondary/system-preference palette, not
removed — existing `dark:` Tailwind variants stay, defaults flip).

Chosen direction: **blue/indigo accent**, close in spirit to SciSpace's own
dark UI (validated against the user's screenshot) without reusing their exact
hex values.

| Token              | Value                                           | Use                                                              |
| ------------------ | ----------------------------------------------- | ---------------------------------------------------------------- |
| `--bg-page`        | `#0d0f14`                                       | Page background (dark)                                           |
| `--bg-card`        | `#161a23`                                       | Card/panel background                                            |
| `--bg-card-accent` | `#1b1f2b` (AI-summary tint), `#12141c` (navbar) | Highlighted sub-panels                                           |
| `--border`         | `#2a3040`                                       | Card/panel borders                                               |
| `--text-primary`   | `#e5e7eb`                                       | Body text                                                        |
| `--text-muted`     | `#8b93a3` / `#9ca3af`                           | Secondary text, metadata lines                                   |
| `--accent`         | `#818cf8`                                       | AI-summary badge, icons                                          |
| `--accent-link`    | `#93c5fd`                                       | Result titles, links                                             |
| `--accent-success` | existing green (`green-700`/`green-400`) kept   | Open-access PDF links — unchanged, not part of this palette swap |

Implementation approach: introduce these as CSS custom properties in
`globals.css` (light values on `:root`, dark values under the existing
`dark:` convention this repo already uses via Tailwind), so components
reference tokens instead of ad hoc `zinc-900`/`blue-700` classes scattered
per-component today. This centralizes the palette in one place for future
sub-projects to reuse rather than re-deriving it.

## Navigation shell

New persistent top navbar (new component, `src/components/nav/TopNav.tsx`),
rendered from `layout.tsx` so it appears on every page:

- **Left:** wordmark/logo ("Scholastic").
- **Center:** a compact search input — but **only rendered once a query is
  active** (i.e. on the results view). On the bare homepage the navbar
  center is empty; the large task box (see Homepage below) is the sole
  search entry point there, so the two never appear together.
- **Right, in order:**
  - `Search` — active nav item, links to `/`.
  - `Library` — **visible but muted/disabled** styling (reduced opacity,
    `cursor: default`, no `href`), with a small "Soon" tag. Not a dead link —
    intentionally non-interactive until sub-project #5 exists.
  - `Health` — links to the existing `/health` page (currently unreachable
    from any nav — this is a real gap being fixed, not new functionality).
  - Avatar placeholder (circle, no menu) — inert visual placeholder for the
    future account system from sub-project #5.

## Homepage (chat/task-first)

Replaces the current centered search hero. Structure (matches the reference
screenshot's pattern, not its copy or branding):

- Wordmark + short prompt line ("How can I help with your research?" or
  equivalent original copy — exact wording is implementation's call).
- A single large task-input box (visually primary element), **functionally
  wired to the existing search flow**: typing a query and submitting runs
  the same search as today. This is a restyle of `SearchBar`'s entry point,
  not a new query-understanding path — `/api/query-understanding` already
  exists and handles free-form input, so no backend change is needed here.
  A `Tools ▾` affordance next to the input is a **visible-but-disabled**
  placeholder (no menu wired up) — future sub-projects hang tool selection
  off it.
  - Note: the navbar (above) _also_ carries a search input once a query is
    active. Resolution: the homepage's large task box only renders on `/`
    with no active query; once a search has been run, the navbar's compact
    search input takes over and the large box is gone — no two simultaneous
    search inputs on screen.
- Below the input, a row of quick-action buttons:
  - `Search Papers` — **functional**, equivalent to submitting the task box
    as a literal search (same flow as above).
  - `Literature Review` — **functional**, routes into the existing
    multi-paper synthesis chat flow (`ChatPanel` with `works`) rather than
    plain search. Reuses what's already built; no new backend.
  - `Draft`, `Diagrams`, `Presentation` — **visible-but-disabled**, same
    "Soon" tag treatment as `Library`. These map to sub-project #8 (AI
    Writer) and beyond, not built here.

No change to `/api/query-understanding`, `/api/search`, or any other route —
this section is a client-side restyle/rewire of existing entry points.

## Component restyle (logic unchanged)

Every one of these keeps its existing props, state, and behavior — only
class names / inline styles change to use the new palette tokens:

- `ResultCard` — dark card background, border token, title in `--accent-link`.
- `SummaryButton` — AI-summary block restyled to the indigo-tinted
  `--bg-card-accent` treatment shown in the reference screenshot (label,
  background, text color), replacing today's `blue-50`/`blue-950` classes.
- `FilterSidebar`, `SearchBar`, `ChatPanel`, `DegradedBanner`, `SourceBadge`,
  `EmptyState`, `CitationsPanel`, `CitationGraphSection`,
  `SimilarPapersPanel`, `ProviderHealthDashboard` — same palette tokens,
  consistent spacing/border-radius scale (match the reference's rounded-lg
  card look already partially present).
- Typography: keep Geist (`next/font/google` `Geist`/`Geist_Mono`, already
  configured) — no font swap. It's already a clean modern sans in the same
  spirit as SciSpace's type.

## Testing

Presentation-only change — no new unit tests expected. Verification is
visual: use the `webapp-testing` skill to click through every page and state
this touches (home/empty state, search results, chat panel open, summary
loading/success/error, degraded-provider banner, `/health` dashboard, and —
since light mode is kept — both themes) and screenshot before/after for
comparison. Existing `vitest` suite must stay green (no logic touched, so no
regressions expected, but run it to confirm).

## Open/low-stakes decisions left to implementation

- Exact homepage prompt copy (see Homepage above).
- Precise spacing/radius scale — match the reference screenshot's proportions
  rather than a specified pixel table.
