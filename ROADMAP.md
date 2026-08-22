# Roadmap

ScholarAI's guiding goal is not to clone Google Scholar but to build something meaningfully
better: an AI-native academic discovery platform. This roadmap sequences work so each phase
ships something real and usable, rather than a long buildup with nothing runnable.

## Milestone 1 — Unified Multi-Source Search (current)

Prove out the data-aggregation layer everything else depends on: fan out to every free
scholarly data source in parallel, dedupe/merge by DOI (with fuzzy fallback), rank, and
surface a clean, fast, accessible search UI. No AI features yet. See `ARCHITECTURE.md` for
the provider-adapter design and `KNOWN_LIMITATIONS.md` for what's intentionally deferred.

Sources: OpenAlex, Crossref, arXiv, Europe PMC, DOAJ, OpenCitations (no-auth), Semantic
Scholar, CORE, Unpaywall, PubMed/NCBI (keyed, graceful degradation when uncredentialed).

## Near-term (post-Milestone 1)

- Streaming/incremental search results (progressive per-provider rendering instead of
  wait-for-all-settled), once perceived latency becomes the top UX complaint.
- Playwright end-to-end test coverage for the search UI.
- Additional no-key/low-friction sources (e.g. bioRxiv/medRxiv, HAL, SSRN metadata where
  permitted) added purely by writing a new provider adapter — no core changes needed.
- Accounts, saved searches, and search history (currently explicitly out of scope; requires
  its own auth design pass).
- Redis-backed shared cache/circuit-breaker state, if/when the app runs across multiple
  serverless instances or regions and the in-memory model's per-instance state becomes a
  measurable problem (see `KNOWN_LIMITATIONS.md`).

## Mid-term — AI-native features

This is the actual differentiator and the reason the project exists. Deferred until
Milestone 1's data layer is solid, since every one of these depends on reliable, deduped
data flowing in from all sources:

- Embeddings for canonical works (pgvector `work_embeddings` table — the `vector` extension
  is already enabled in the first migration specifically so this is a frictionless addition).
- Semantic / natural-language search ("papers that challenge the idea that X").
- AI-generated plain-language summaries per result.
- Citation-graph-aware features (using OpenCitations/Semantic Scholar citation data beyond
  the aggregate count currently stored) — e.g. "papers that cite this and contradict it."
- Research-assistant style chat over a paper or a result set.

## Explicitly out of scope for now

- Mobile native apps (the web app is mobile-first/responsive, but no App Store presence).
- Institutional/library-system integrations (EZproxy, OpenURL resolvers, etc.).
- Any paid/closed-data source requiring a commercial license.
