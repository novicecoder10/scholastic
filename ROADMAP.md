# Roadmap

Scholastic's guiding goal is not to clone Google Scholar but to build something meaningfully
better: an AI-native academic discovery platform. This roadmap sequences work so each phase
ships something real and usable, rather than a long buildup with nothing runnable.

## Milestone 1 — Unified Multi-Source Search ✅ shipped (v0.1.0, 2026-07-26)

Prove out the data-aggregation layer everything else depends on: fan out to every free
scholarly data source in parallel, dedupe/merge by DOI (with fuzzy fallback), rank, and
surface a clean, fast, accessible search UI. No AI features yet. See `ARCHITECTURE.md` for
the provider-adapter design and `KNOWN_LIMITATIONS.md` for what's intentionally deferred.

Sources: OpenAlex, Crossref, arXiv, Europe PMC, DOAJ (no-auth), Semantic Scholar, CORE,
Unpaywall, PubMed/NCBI (keyed, graceful degradation when uncredentialed).

**OpenCitations note:** OpenCitations' public API (COCI/Meta) is a citation-graph index
queryable by known identifier (DOI/OMID), not a full-text keyword search engine — it has no
endpoint equivalent to the other nine sources' "search by query string." It therefore cannot
participate in the search fan-out the same way. Rather than fake a search capability it
doesn't have, it was moved to Milestone 2's citation-graph-aware features (shipped below),
where it enriches already-identified works (via their DOIs) with citation-network data
instead of discovering new works from a query.

## Milestone 2 — AI-Native Features ✅ shipped (2026-07-27)

This is the actual differentiator and the reason the project exists. All four originally-
mid-term AI items shipped together once Milestone 1's data layer was solid, since every one
depends on reliable, deduped data flowing in from all sources. See `ARCHITECTURE.md`'s
"AI-native features" section for the full design and `KNOWN_LIMITATIONS.md` for what's
intentionally deferred (e.g. semantic search as a re-ranked live candidate pool, not a
pre-built corpus index).

- Semantic / natural-language search (`?mode=semantic`) via embeddings — hosted (OpenAI,
  optional) with a local (`@xenova/transformers`) fallback requiring no API key.
- AI-generated plain-language summaries per result (`POST /api/works/[workKey]/summary`,
  Anthropic Claude, cached).
- Citation-graph-aware features: OpenCitations queried by DOI (not keyword) plus Semantic
  Scholar's citation-detail endpoints, merged (`GET /api/works/[workKey]/citations`).
- Research-assistant style chat over a paper (`POST /api/chat`, streaming, no persistence).

## Milestone 3 — Citation Graph, Conversational Search, Multi-Paper Synthesis, Citation

Reasoning ✅ shipped (2026-07-27)

Requested as part of a larger wishlist; scoped down to the four items below (via
AskUserQuestion) since the rest — persistent per-user research memory, autonomous multi-step
research agents, a reproducibility workspace extracting code/datasets/hyperparameters — each
need real foundational work first (accounts/auth design; full-text/PDF ingestion, which this
app has never done — only abstracts from provider APIs) rather than being a quick add-on. See
`ARCHITECTURE.md`'s "AI-native features (Milestone 3)" section for the full design.

- Interactive node-based citation graph (`react-force-graph-2d`), with lazy by-DOI expansion
  for papers reached only via a citation edge, capped at ~150 nodes.
- Conversational/agentic search bar (`POST /api/query-understanding`) — rewrites natural-
  language input into a search query/mode, or asks a clarifying question, always falling back
  to literal keyword search on any failure.
- Multi-paper synthesis chat — reasons across the current result set (retrieval-augmented over
  their abstracts, via the embeddings already built for semantic search), not one paper at a
  time.
- Citation reasoning ("who built on whom, and why") for a specific citation edge, cached
  permanently.
- A new LLM backend, OpenRouter (`lib/ai/llm/openrouter.ts`), added as a free-tier fallback
  behind Anthropic — the user's own free-tier credential, unrelated to and clearly distinct
  from sourcing/scraping leaked keys (refused; see `PROJECT_LOG.md`).

## Product sequence — toward a SciSpace-class surface (9 sub-projects)

After Milestone 3, the work was re-planned as a dependency-ordered sequence of nine
sub-projects (see `docs/specs/2026-08-23-scispace-visual-redesign-design.md` for
the full framing), gamified around a non-monetary credits system — no paid tiers. Three items
from the reference feature set (Agent Gallery's 2,602 agents, a 5,405-item template library,
and an AI-detector claiming benchmarked accuracy over GPTZero/Grammarly) are platform-scale or
not honestly buildable, and are deferred indefinitely by explicit decision.

1. **Visual redesign** ✅ shipped (v0.4.0, 2026-09-05) — dark-first token palette, persistent
   nav shell, chat/task-first homepage. Presentation-only: no API, data-flow, or logic change.
2. **File-upload infrastructure** ✅ shipped — PDF upload, storage, page-aware chunking,
   embedding, and `retrieveChunks()`, the contract #3 and #7 consume. Not user-facing.
3. **Chat with PDF** ✅ shipped — `/reader` upload plus a `/reader/[documentId]` split view;
   `/api/chat` takes a `documentId` and answers with `[p. N]` citations that scroll the PDF.
4. **Quick-win tools** ✅ shipped — deterministic citations in five formats, topic discovery
   that narrows the result list, and a clarity rewriter for the user's own prose.
5. **Library / workspace + accounts** ✅ shipped — optional email/OAuth accounts, a library of
   saved papers, uploads and collections, and adoption of anonymous uploads on sign-up. The
   persistence and identity layer #6 and #8 build on.
6. **Credits and sponsorship** ✅ shipped — a shared pool of donated AI capacity, an
   append-only credit ledger, ORCID-verified contribution grants, and a public sponsor list.
   Credits are never purchasable and never earned by in-app activity.
7. **Extract data** ✅ shipped — geometric table detection, quoted prose statistics, and an
   evidence matrix whose every filled cell carries the page and sentence it came from.
8. **AI writer** ✅ shipped — a manuscript editor whose citations are objects, a derived
   bibliography, four exports, and one grounded drafting mode that cannot produce an uncited
   sentence.
9. **Citation-graph explorer** ✅ shipped — the graph logic extracted into a tested pure layer,
   node identity unified with the rest of the app, a full-page multi-root explorer, deterministic
   structural analysis, and an accessible DOM fallback.

All nine are shipped. Each got its own brainstorming round and spec; they live in
`docs/specs/`.

### After the nine: the homepage's unbuilt promises

The task-first homepage shipped in #1 with five quick actions, three of them labelled _Soon_.
They are now built, and two were renamed on the way because the honest version is narrower
than the label:

- **Draft** — creates a manuscript from the query and opens #8's editor. No new subsystem.
- **Diagrams → Citation map** — the only diagram this app draws is the citation graph, so the
  chip says so. A chip promising figure generation would have been the fastest way to make the
  rest of the app untrustworthy.
- **Presentation** — new: `/present` outlines a deck from the literature with a citation on
  every bullet, reusing #8's guard shape and #4's formatters.

## Near-term (post-Milestone 3)

- Streaming/incremental search results (progressive per-provider rendering instead of
  wait-for-all-settled), once perceived latency becomes the top UX complaint.
- Playwright end-to-end coverage for the AI-feature affordances (summary button, citations
  panel + graph view, chat panel, search-bar clarify loop, homepage quick actions). Playwright
  itself arrived with #5 and covers accounts, adoption and the library; verification of the
  search and AI surfaces is still screenshot-driven and manual.
- Additional no-key/low-friction search sources (e.g. bioRxiv/medRxiv, HAL, SSRN metadata
  where permitted) added purely by writing a new provider adapter — no core changes needed.
- Redis-backed shared cache/circuit-breaker state, if/when the app runs across multiple
  serverless instances or regions and the in-memory model's per-instance state becomes a
  measurable problem (see `KNOWN_LIMITATIONS.md`).
- DB-side ANN search over the accumulated `work_embedding` corpus (the hnsw index already
  exists for this) as a supplementary semantic-search candidate source — "papers I've
  encountered before that relate to this," not a replacement for live provider retrieval.
- A graph-edge schema for citation data, if a product surface emerges that needs actual graph
  traversal (multi-hop citation paths) rather than per-work "who cites this" lookups.

## Mid-term — needs its own foundation-design pass first

These were explicitly deferred, not rejected — each needs real foundational work before it's
buildable at all, not a quick add-on to the current architecture:

- **Accounts, saved searches, search history, and persistent research memory** (what a user has
  read/highlighted/is currently investigating) — needs an auth/session design pass. Chat and
  synthesis currently have no persistence for the same reason.
- **Reproducibility workspace** (extracting code, datasets, hyperparameters, experiment
  pipelines from papers) — needs full-text/PDF ingestion, a capability this app has never had;
  every provider integration so far only ever sees abstracts, never full paper text.
- **Autonomous, end-to-end multi-step research agents** (planning, multi-hop retrieval,
  self-directed synthesis) — realistically builds on top of persistent memory and/or
  reproducibility extraction rather than preceding them.

## Explicitly out of scope for now

- Mobile native apps (the web app is mobile-first/responsive, but no App Store presence).
- Institutional/library-system integrations (EZproxy, OpenURL resolvers, etc.).
- Any paid/closed-data source requiring a commercial license.
