# Project Log

Running development log, one entry per work session. Newest entries at the top.

---

## 2026-07-26 — Project kickoff & Milestone 1 planning

- Defined the project constitution and mission: an AI-native academic discovery platform
  aggregating OpenAlex, Semantic Scholar, Crossref, PubMed, arXiv, CORE, Europe PMC, DOAJ,
  OpenCitations, and Unpaywall.
- Locked in stack decisions with the user: Next.js (App Router) + TypeScript + Tailwind +
  Postgres/pgvector, single full-stack app, pnpm.
- Locked in Milestone 1 scope: unified multi-source search only, no AI features yet.
- Locked in the provider-credential model: no-auth sources work with zero config; keyed
  sources (Semantic Scholar, CORE, Unpaywall, PubMed) auto-detect env-var credentials and
  gracefully degrade (disable themselves) when absent — a provider failure or absence must
  never fail the overall search. Resilience (retry/backoff/timeout/circuit-breaker/cache) is
  implemented once, generically, in an orchestrator layer, not per-adapter.
- Produced and approved a full architecture plan (see git history / plan artifact) covering
  the provider adapter contract, resilience layer design, dedup/merge/ranking algorithm,
  minimal DB schema, API contract, frontend structure, testing strategy, and doc plan.
- Scaffolded the Next.js app via `create-next-app` (landed on Next.js 16, TypeScript, Tailwind
  v4, App Router, `src/` layout, pnpm). Confirmed Cache Components is **not** enabled in
  `next.config.ts`, so classic App Router conventions apply (async `searchParams`, plain
  async Route Handlers) rather than the new `use cache`/Suspense-mandatory model.
- Added Prettier (+ `prettier-plugin-tailwindcss`), initialized git, wrote `.env.example` and
  the initial doc set (this file, `ARCHITECTURE.md`, `ROADMAP.md`, `KNOWN_LIMITATIONS.md`,
  `CHANGELOG.md`, `SETUP.md`).
- Next: DB layer (Drizzle + pgvector), then the resilience layer, then the first two provider
  adapters end-to-end.
