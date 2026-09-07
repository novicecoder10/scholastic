# Scholastic

An AI-native academic discovery platform — not a Google Scholar clone, but something
meaningfully better: one unified, deduplicated search across OpenAlex, Semantic Scholar,
Crossref, PubMed, arXiv, CORE, Europe PMC, DOAJ, and Unpaywall.

**Milestone 1:** unified multi-source search — fan out to every source in parallel,
dedupe/merge by DOI (with fuzzy fallback), rank, and surface results through a fast,
accessible search UI.

**Milestone 2:** AI-native features — semantic/natural-language search (embeddings, hosted or
fully local with no API key required), AI-generated plain-language summaries, citation-graph
enrichment (who cites this, what does it cite), and research-assistant chat over a paper.

**Milestone 3:** an interactive node-based citation graph, a conversational/agentic
search bar (ask a question in plain language; it rewrites it into a search or asks a
clarifying question), multi-paper synthesis chat (reason across an entire result set, not one
paper at a time), and citation reasoning ("why does this paper cite that one"). Every AI
feature degrades gracefully (a clear "not configured" response, never a crash) when no LLM
API key is set — Anthropic and a genuinely free OpenRouter tier are both supported.

**Product sequence:** nine sub-projects on top of the three milestones, all shipped, plus the homepage's three remaining quick actions (Draft, Citation map, Presentation) — **#1** a dark-first visual redesign and nav shell; **#2** PDF upload, storage, page-aware
chunking and embedding; **#3** chat with a PDF in a split reader that answers with `[p. N]`
citations you can click; **#4** deterministic citations in five formats, topic discovery that
narrows a result set, and a clarity rewriter; **#5** optional accounts, a library of saved
papers, uploads and collections, and adoption of anonymous uploads on sign-up; **#6** a shared
pool of donated AI capacity with an explainable credit ledger, ORCID-verified contribution
grants, and a public sponsor list — credits are never purchasable and never earned by using the
app; **#7** table and statistic extraction from uploaded PDFs, and an evidence matrix where every
filled cell carries the page and the sentence it came from; **#8** a manuscript editor whose
citations are objects — derived bibliography, four exports, and a drafting mode that cannot
produce an uncited sentence; **#9** a full-page citation-graph explorer over a tested pure graph
layer, with deterministic structural analysis labelled "within the loaded subgraph". All nine are
shipped — see [`ROADMAP.md`](./ROADMAP.md).

Everything optional stays optional: with no LLM key, no `SESSION_SECRET`, or no
`BETTER_AUTH_SECRET`, the corresponding feature is absent and says so — never broken.

## Documentation

- [`SETUP.md`](./SETUP.md) — prerequisites, environment configuration, running locally.
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — system design, provider adapter contract,
  resilience layer, dedup/merge/ranking algorithm, API contract.
- [`ROADMAP.md`](./ROADMAP.md) — what's built, what's next, what's explicitly out of scope.
- [`KNOWN_LIMITATIONS.md`](./KNOWN_LIMITATIONS.md) — deliberate trade-offs and known gaps.
- [`CHANGELOG.md`](./CHANGELOG.md) — release history.
- [`PROJECT_LOG.md`](./PROJECT_LOG.md) — running development log.

## Quick start

```bash
pnpm install
cp .env.example .env.local   # set at least DATABASE_URL — see SETUP.md
pnpm db:migrate
pnpm dev
```

Then visit http://localhost:3000 and search for something.

```bash
pnpm test    # unit + integration tests (Vitest)
pnpm lint    # ESLint
pnpm build   # production build
```
