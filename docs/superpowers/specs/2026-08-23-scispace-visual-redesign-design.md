# Scholastic visual redesign (SciSpace-inspired) — Design

## Context

Scholastic's current UI is a light-mode, Tailwind-default-styled Next.js app
with no persistent navigation — the homepage is a centered search hero, and
there is no link anywhere to the existing `/health` page. The user wants a
visual overhaul inspired by [SciSpace](https://scispace.com/): dark theme,
card-based AI-summary treatment, persistent top nav.

This is sub-project **1 of 5** in a larger plan to bring Scholastic toward a
SciSpace-like product surface, gamified around a non-monetary credits system
(earned by publishing in indexed venues, completing peer reviews, etc. — no
paid tiers). The full sequence, in dependency order:

1. **Visual redesign** (this spec) — restyle existing pages/components, add
   persistent nav shell. No new data, no new pages with real functionality.
2. Library / workspace + accounts — the persistence + identity layer
   gamification needs (Scholastic currently has none).
3. Gamification mechanics (credits/points, earned via research actions) —
   built on #2.
4. Per-paper AI copilot enhancements.
5. Citation graph explorer enhancements.

Each of 2–5 gets its own brainstorming round and spec when its turn comes.
This spec covers **only** #1.

## Goals

- Restyle the existing app to a SciSpace-inspired dark, card-based aesthetic.
- Add a persistent top navbar as a structural home for future pages.
- Change **zero** application logic, data flow, or API behavior — this is a
  presentation-layer-only pass.

## Non-goals

- No new pages with real functionality (Library is a visible-but-disabled
  nav placeholder only).
- No accounts, persistence, or gamification UI — those are later sub-projects.
- No pixel-identical clone of SciSpace's actual brand colors (see palette
  rationale below) — the interaction patterns and layout are the same, the
  palette is original.

## Palette

Dark-first (light mode kept as the secondary/system-preference palette, not
removed — existing `dark:` Tailwind variants stay, defaults flip).

Chosen direction: **blue/indigo accent**, close in spirit to SciSpace's own
dark UI (validated against the user's screenshot) without reusing their exact
hex values.

| Token | Value | Use |
|---|---|---|
| `--bg-page` | `#0d0f14` | Page background (dark) |
| `--bg-card` | `#161a23` | Card/panel background |
| `--bg-card-accent` | `#1b1f2b` (AI-summary tint), `#12141c` (navbar) | Highlighted sub-panels |
| `--border` | `#2a3040` | Card/panel borders |
| `--text-primary` | `#e5e7eb` | Body text |
| `--text-muted` | `#8b93a3` / `#9ca3af` | Secondary text, metadata lines |
| `--accent` | `#818cf8` | AI-summary badge, icons |
| `--accent-link` | `#93c5fd` | Result titles, links |
| `--accent-success` | existing green (`green-700`/`green-400`) kept | Open-access PDF links — unchanged, not part of this palette swap |

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
- **Center:** the search input (replaces the current centered-hero
  `SearchBar` placement on `/` — same component, moved, same behavior/props).
- **Right, in order:**
  - `Search` — active nav item, links to `/`.
  - `Library` — **visible but muted/disabled** styling (reduced opacity,
    `cursor: default`, no `href`), with a small "Soon" tag. Not a dead link —
    intentionally non-interactive until sub-project #2 exists.
  - `Health` — links to the existing `/health` page (currently unreachable
    from any nav — this is a real gap being fixed, not new functionality).
  - Avatar placeholder (circle, no menu) — inert visual placeholder for the
    future account system from sub-project #2.

The homepage (`page.tsx`) loses its centered hero `<h1>`/tagline block; that
copy either moves into an empty-state (no query yet) or is dropped in favor
of the navbar's search box being the sole entry point — final call left to
implementation (low-stakes copy decision, not a design fork).

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

- Exact homepage copy once the hero block is removed (see Navigation shell).
- Precise spacing/radius scale — match the reference screenshot's proportions
  rather than a specified pixel table.
