# Architecture

## Overview

Scholastic is a single Next.js (App Router, TypeScript) application. There is no separate
backend service: Next.js Route Handlers serve as the API layer, and Postgres (with the
`pgvector` extension) is the only required external dependency — OpenAI/Anthropic (Milestone
2's AI features) and OpenCitations' access token are all optional, auto-detected, and
gracefully degrade to a disabled feature (never a broken app) when absent.

```
Browser
  │  GET /?q=...                         GET /api/search?...     GET /api/health/providers
  ▼                                              │                        │
Server Component (app/page.tsx)                  ▼                        ▼
  │  (calls performSearch()             Route Handler              Route Handler
  │   directly, no network hop,         (app/api/search/route.ts)  (reads health store)
  │   for SSR)                                   │
  ▼                                              ▼
lib/search.ts — performSearch()
  │  cache check (query text only) → on miss, fan out → merge → rank → cache write
  │  → filterWorks() + paginate, applied fresh on every call regardless of cache hit
  ▼
Provider Orchestrator (lib/providers/orchestrator.ts)
  │
  ├─ wraps every adapter call in withResilience() ──► Circuit breaker / retry+backoff /
  │                                                     timeout / cache (lib/resilience/)
  │
  ├─ OpenAlex ─┐
  ├─ Crossref  │
  ├─ arXiv     │  Promise.allSettled fan-out, one HTTP client each,
  ├─ EuropePMC │  each mapped to a common RawWork shape
  ├─ DOAJ      │
  ├─ Semantic Scholar (optional key)
  ├─ CORE (requires key)
  ├─ Unpaywall (requires email)
  └─ PubMed/NCBI (requires email, optional key)
        │
        ▼
Dedup / Merge / Rank (lib/merge/)
  normalize → match (DOI-exact ∪ fuzzy fallback) → reconcile → rank
        │
        ▼
SearchResponse { results, providerStatuses, degraded, cached }
```

(OpenCitations is deliberately not registered — its API has no keyword-search capability;
see `KNOWN_LIMITATIONS.md` and `ROADMAP.md`.)

## Provider adapter contract

Every data source is implemented as an independent adapter behind one interface
(`src/lib/providers/types.ts`):

```ts
interface ProviderAdapter {
  meta: ProviderMeta; // id, displayName, requiresCredential, isEnabled, defaultTimeoutMs?
  isConfigured(): boolean; // env-detected; false disables the provider without error
  search(options: SearchOptions): Promise<RawSearchResult>;
}
```

Adding or removing a source is adding/deleting one `lib/providers/<name>/` directory
(`adapter.ts` + `mapper.ts` + `adapter.test.ts`) and one line in `registry.ts`. Nothing else
in the app references provider names directly — the orchestrator, health endpoint, and merge
layer all iterate `getEnabledProviders()` generically.

Credential detection lives entirely inside each adapter, reading its own env var(s)
(`UNPAYWALL_EMAIL`, `CORE_API_KEY`, `NCBI_EMAIL` + optional `NCBI_API_KEY`, optional
`SEMANTIC_SCHOLAR_API_KEY`). No-auth adapters are always enabled. Frontend code never sees
any of these values — only the backend route handlers read `process.env`.

## Resilience layer

`withResilience(providerId, fn, opts)` (`src/lib/resilience/withResilience.ts`) is the single
wrapper every provider call goes through, applied only by the orchestrator — adapters never
call it themselves, which is what guarantees uniform behavior:

1. Check cache (in-process LRU, `lib/resilience/cache.ts`) — return immediately on hit.
2. If the provider's circuit breaker is `open` and not yet ready for a half-open trial, fail
   fast with `ProviderSkippedError` (no HTTP call attempted).
3. Otherwise attempt the call under an `AbortController` timeout (default 6000ms, overridable
   per-provider via `meta.defaultTimeoutMs`), retrying up to 2× with exponential backoff+jitter.
4. Record the outcome into a per-provider `ProviderHealthRecord` (circuit state, consecutive
   failures, rolling latencies, rate-limit-remaining if the response exposes it) and, on
   success, populate the cache.

**Circuit breaker** (`lib/resilience/circuitBreaker.ts`) — three states per provider:

- `closed`: normal operation; trips to `open` at 5 consecutive failures or ≥0.8 failure rate
  over the last 10 calls.
- `open`: rejects immediately for a cooldown (starts at 30s, doubles up to a 5 min cap on
  repeated failures) — this is what stops a consistently-failing provider from being hammered
  and from eating into the overall request's time budget.
- `half_open`: after cooldown, exactly one trial call is allowed through; success → `closed`
  (counters reset), failure → back to `open` with the cooldown doubled.

**Cache backend**: in-process `lru-cache`, chosen over Redis for Milestone 1 because
scholarly metadata is near-static (low correctness bar) and the app isn't yet running at a
scale where shared cross-instance cache matters — see `KNOWN_LIMITATIONS.md`. It sits behind
a small `CacheBackend` interface so a `RedisCacheBackend` can be swapped in later without
touching call sites.

## Dedup / merge / ranking

1. **Match**: union-find over all `RawWork`s returned for a query. DOI-exact matches (after
   normalizing case and stripping the `https://doi.org/` prefix) are unioned first. Remaining
   DOI-less works (e.g. some arXiv preprints) are bucketed by `(year ± 1, firstAuthorSurname)`
   and compared via Jaro-Winkler similarity on normalized titles; a match requires similarity
   ≥ 0.92. This threshold is deliberately conservative — incorrectly merging two distinct
   papers is worse than occasionally under-merging a true duplicate.
2. **Reconcile**: each matched cluster becomes one `CanonicalWork` — longest non-arXiv title,
   Crossref-wins-on-conflict DOI, author list from whichever source has the most ORCIDs, modal
   year (published version preferred over preprint on ties), **max** citation count across
   sources (each source's citation graph is independently incomplete), OA/PDF link true if any
   source reports it (Unpaywall's link preferred when multiple agree), and a `sources[]` array
   recording every contributing provider for the UI's source badges.
3. **Rank**: `score = 6.0·relevance + 2.0·log10(citations+1) + 1.0·sourceAgreementCount + 0.8·recencyBoost +
0.3·isOpenAccess`. `relevance` is a token-overlap score between the query and the work's
   title/authors/abstract/venue (bonus weight for a match landing in title or authors, the
   highest-signal fields) — it dominates the other terms so an on-topic result always outranks
   an off-topic one, regardless of citation count. Works with **zero** query-term overlap
   anywhere are dropped entirely before scoring, not just down-ranked: a result sharing not one
   term with the query has no business appearing, however highly cited. Among works of
   comparable relevance, citation count (log-scaled), cross-source agreement, recency, and OA
   status break ties. Still keyword-based, not semantic — see `KNOWN_LIMITATIONS.md` for what
   that means in practice and the v2 target (field-normalized citations, BM25-style scoring).

## API contract

`GET /api/search` — deliberately **GET-only**: every parameter (`q`, `mode`, `page`, `perPage`,
`yearFrom`, `yearTo`, `openAccessOnly`, `minCitations`, `sources`) is a simple key/value
filter, and GET keeps results bookmarkable/shareable/cacheable-by-intermediaries, properties
a POST body would give up for no benefit here. Parsing and the full request/response types
live in `src/lib/types/search.ts`. `mode=semantic` (Milestone 2) is fully backward compatible —
omitted or any other value defaults to `"keyword"`, identical to pre-Milestone-2 behavior.

Returns **HTTP 200** whether some or all providers failed — provider failure is an expected
operational condition (`degraded: true`, per-provider `providerStatuses[]`), not an
application error. Reserve 5xx for genuine bugs (unhandled exceptions, DB failures writing
the cache — though even those are caught and logged rather than thrown, see below). 400 is
reserved for malformed requests (e.g. empty query). No streaming/SSE for Milestone 1:
dedup/merge/rank need the full all-settled result set to be correct, so the response is a
single JSON payload bounded by the per-provider timeout.

**Cache key is the query text (and, since Milestone 2, search mode) — not filters or
pagination.** `lib/search.ts`'s `performSearch()` caches the full merged+ranked result set per
query+mode, then applies `filterWorks()` (`lib/merge/filter.ts`) and pagination fresh on every
call. This means one cached fan-out serves every filter/page combination for a given
query+mode, rather than needing a separate cache entry per combination — verified live: a
request with new filters against an already-searched query returned `cached: true` and the
correctly-filtered subset, with no new provider calls. This same `filterWorks()` function is
reused by the frontend's client-side filter sidebar (`components/search/filters.ts`) so
client-side and server-side filtering can never define "matches these filters" differently.
`mode=semantic` (see "AI-native features" below) reuses this exact same cache mechanism —
`SearchCacheFilters.mode` is folded into the cache-key hash, giving semantic-mode results their
own cache namespace for the same query text without any schema change (an omitted/keyword mode
hashes identically to before, so existing keyword-mode cache behavior is unaffected).

## Database

Seven tables (`src/lib/db/schema.ts`): `search_cache` (durable complement to the in-memory
LRU), `provider_health_snapshot` (periodic persisted health/metrics), `work` (canonical
persisted records — populated by every search's fire-and-forget upsert since Milestone 2; see
"Stable work identity" below), Milestone 2's `work_embedding`, `work_ai_summary`,
`citation_cache`, and Milestone 3's `citation_reasoning_cache` (all described under "AI-native
features"). The `pgvector` extension was enabled in the first migration ahead of any actual
vector columns, specifically so embeddings could be added later without a disruptive
migration — exactly what happened.

## AI-native features (Milestone 2)

### Stable work identity

`CanonicalWork.id` is explicitly scoped to one search response only (see its doc comment) — not
usable to reference a paper across separate HTTP requests, which every feature below needs
(click "Summarize" → a later, unrelated request). `getWorkKey()` (`lib/ai/workKey.ts`) computes
a stable cross-request key: the normalized DOI when present, else a SHA-256 hash of normalized
title+year+first-author-surname+venue — both branches hashed, so every key is a uniform,
URL-safe opaque token (a raw DOI's `/` would otherwise split a Next.js route segment). It's
computed once in `reconcileCluster()` and stored as `CanonicalWork.workKey`, flowing through
the API response and every component for free.

The content-hash fallback requires an _exact_ match on normalized title (stricter than the
fuzzy dedup matcher's 0.92 Jaro-Winkler threshold — see `merge/matcher.ts`), so a cross-response
collision between two genuinely different DOI-less papers requires byte-identical normalized
title+year+author+venue, which is rare. `performSearch()` fire-and-forget upserts every result
into the `work` table by `workKey` (`lib/db/workPersistence.ts`) — finally wiring up a table
that had existed since Milestone 1's migration 0000 but was never written to. On a hash-key
conflict, the upsert compares the _abstract_ text (word-level Jaccard overlap — not Jaro-Winkler,
which is a character-level metric miscalibrated for paragraph-length text) between the stored
and incoming record before overwriting, since title/year/author/venue are already guaranteed
identical by construction of the hash and comparing them again would prove nothing; abstract is
the one substantive field left that isn't a hash input. A mismatch logs a warning and skips the
write rather than silently corrupting a different paper's record.

### Semantic search

`EMBEDDING_DIMENSIONS = 384` (`lib/db/schema.ts`) is shared by two interchangeable backends
(`lib/ai/embeddings/`): `openaiEmbeddingProvider` (hosted, `text-embedding-3-small` truncated to
384 dims via its native `dimensions` param) when `OPENAI_API_KEY` is set, else
`localEmbeddingProvider` (`@xenova/transformers`, `Xenova/all-MiniLM-L6-v2`, which natively
outputs 384 dims — no truncation needed). `getActiveEmbeddingProvider()` is the single selection
point, mirroring the search-provider registry's auto-detect-and-degrade pattern exactly.

**Semantic mode does not pre-build a from-scratch index over all of scholarship** — that's
infeasible for any small app (OpenAlex alone is 250M+ works). Instead, `?mode=semantic` re-runs
the _exact same_ live multi-provider fan-out + dedup as keyword search, then ranks that same
candidate pool by cosine similarity to the query instead of keyword-token overlap
(`rankBySemanticSimilarity()`, `lib/ai/semanticRank.ts`). This means **semantic mode still
depends on provider-side keyword retrieval to produce its candidate pool** — a natural-language
query only surfaces good candidates to the extent it also contains tokens the providers' own
search can match on (verified live: a phrasing with weak keyword overlap to the target topic
produced a noticeably weaker candidate pool than one closer to the papers' own terminology — see
`KNOWN_LIMITATIONS.md`).

`work_embedding` caches each work's vector, keyed by **`(workKey, embeddingModelId)`, not
`workKey` alone** — a cache hit under a different model than the one currently active must be
treated as a miss and recomputed, since the same dimensionality from two different models is
not a comparable vector space; mixing them would silently corrupt ranking with no visible error.
This table is a cross-query compute cache for v1, not a searchable index, but carries an hnsw
`vector_cosine_ops` index anyway (cheap now, avoids a disruptive migration if the accumulated
corpus becomes useful as a supplementary DB-side ANN candidate source later).
`rankWorksBySimilarity()` (`lib/merge/rank.ts`) mirrors `rankWorks()`'s structure — same
citation/recency/OA tie-breaking terms via a shared `baseScore()` helper — but replaces the
zero-token-overlap filter with a `MIN_SEMANTIC_SIMILARITY` floor (embedding similarity has no
natural "unrelated" cutoff the way token overlap does).

**Observed cost**: with the local embedding backend, a semantic-mode query's first encounter
with ~90 uncached candidates took tens of seconds (CPU inference); a repeated query against
already-cached candidates was near-instant. The hosted OpenAI backend is a single batched HTTP
call instead and would not have this cost — see `KNOWN_LIMITATIONS.md`.

### AI summaries and chat

`@anthropic-ai/sdk` (`lib/ai/llm/anthropic.ts`) — no local fallback here (unlike embeddings): a
locally-run model isn't a usable substitute for summarization/chat quality on typical hardware.
Absent `ANTHROPIC_API_KEY`, both features return a clear `503` rather than degrading silently,
the same precedent as CORE/Unpaywall/PubMed without their own credentials. Two different models
for two different jobs (the provider takes `model` per call, not hardcoded): `complete()` with
`claude-haiku-4-5-20251001` for summaries (bulk, low-complexity-per-call, on-demand per result —
not eagerly generated for every search result) via the standard `withResilience` wrapper;
`streamComplete()` with `claude-sonnet-5` for chat (needs to reason across a multi-paper result
set) via `client.messages.stream()`, deliberately bypassing `withResilience`'s retry/cache
machinery — retrying mid-stream would silently restart a partially-delivered response, worse UX
than surfacing the failure once. A plain timeout still applies.

`work_ai_summary` is a read-through cache keyed by `workKey` in front of the Anthropic call
(`lib/ai/summary.ts`), looking the work's title/abstract up from the `work` table rather than
requiring the caller to supply it, since a summary request is a separate HTTP call from the
search that originally surfaced the work. `POST /api/works/[workKey]/summary` (POST, not GET —
it triggers a real LLM call with cost/latency on a cache miss, not a pure repeatable read).

Chat (`POST /api/chat`) streams plain text chunks (not full SSE framing — this is our own
backend consumed by our own frontend's `ReadableStream` reader, so SSE's event-typing/
reconnection semantics would be unused complexity). **No persistence**: the client resends the
full message history on every turn; accounts/saved state are explicitly out of scope for this
milestone (see `ROADMAP.md`).

### Citation-graph enrichment

No graph-edge schema for v1 — there's no product surface yet needing graph traversal, just
per-work enrichment. `citation_cache` (`workKey`, `source`, `payload jsonb`, `fetchedAt`) is a
read-through cache with an explicit 1-week TTL (citation counts/citing-lists genuinely change
over time, unlike an abstract) in front of two by-DOI sources, both routed through
`withResilience` exactly like every other external dependency: OpenCitations' COCI API
(`lib/ai/citations/opencitations.ts` — bare DOIs only, no titles; this is the same API
Milestone 1 excluded from the _search_ fan-out for having no keyword-search capability, used
here for exactly the by-identifier lookup it's built for) and a Semantic Scholar citation-detail
extension (`providers/semanticscholar/citations.ts` — titles/years where covered).
`mergeCitationRefs()` dedupes the two sources' results by normalized DOI, preferring whichever
entry has a title on a duplicate. `GET /api/works/[workKey]/citations` (GET, unlike summary's
POST — this only fetches free public metadata, a cacheable repeatable read). A DOI-less work
can't be enriched by either source — reported as `degraded: true` with empty results, not an
error, since that's a normal state for many records, not a failure.

## AI-native features (Milestone 3)

### LLM provider selection + OpenRouter

`getActiveLlmProvider()` (`lib/ai/llm/index.ts`) mirrors the embeddings layer's
`getActiveEmbeddingProvider()` selection pattern: Anthropic when `ANTHROPIC_API_KEY` is set
(dedicated, already-tuned model tiers), else `openrouterLlmProvider` when only
`OPENROUTER_API_KEY` is set (a genuine free tier — some Llama/Gemma/Nemotron variants), else
`null`. Every AI-feature route checks this and returns a clear `503` rather than crashing. Each
backend declares its own `models: { cheap, capable }` — a bulk/low-complexity job (summaries,
query understanding, citation reasoning) uses `cheap`; a job needing to reason across more
context (chat, synthesis) uses `capable`. `openrouterLlmProvider` (`lib/ai/llm/openrouter.ts`)
is a plain `fetch` against OpenRouter's OpenAI-chat-completions-compatible API (not Anthropic's
Messages shape) — `complete()` goes through the standard `withResilience` wrapper;
`streamComplete()` hand-parses the streamed `data: {...}` SSE frames (no SDK doing this for us),
buffering across chunk boundaries. **Both `complete()` implementations use a 30s timeout, not
the 6s default** tuned for metadata-fetch API calls — discovered live: a real completion (full
prompt, not a trivial test) on the free tier took long enough to exceed 6s and fail after
retries, even though the backend was healthy and would have eventually responded. Streaming
already used 30s for the same reason; non-streaming needed the same fix.

### Interactive citation graph

Citation-graph expansion (clicking a node reached only via a citation edge — never searched for
directly, so it has no `work` row) needed a way to fetch citation data by bare DOI alone.
`getCitationEnrichmentByDoi(doi)` (`lib/ai/citations/enrichment.ts`) is the core two-source
fetch-and-cache logic, refactored out of the original `getCitationEnrichment(workKey)` (now a
thin wrapper: look up the work's DOI, delegate). **The cache-key invariant**: the DOI-keyed
cache entry uses `getWorkKey()`'s own DOI branch to derive its key — not a second scheme — so an
expansion node's cache row and a later "actually searched for this paper" `work` row converge on
the exact same key automatically. `GET /api/citations/by-doi?doi=<encoded>` uses a **query
param, not a dynamic path segment**: a DOI's `/` becomes `%2F` when encoded, a known source of
silent 404s through proxies/CDNs that normalize `%2F`→`/` before Next ever sees the request.

`CitationGraph` (`components/search/CitationGraph.tsx`) — canvas-based force-directed graph via
`react-force-graph-2d` (the dedicated 2d sub-package, not the umbrella package, which would pull
in three.js unnecessarily; `react: '*'` peer-dep, compatible with React 19), dynamically
imported with `{ ssr: false }` since it touches `window`/canvas at load. Center node = root
paper; first ring = its citing/cited papers (already fetched by the existing workKey-based
route); clicking a non-root node lazily fetches its own citations via the by-DOI route and
merges new nodes/edges into local state, capped at ~150 total nodes to bound an otherwise-
unbounded fetch cascade. A "View as graph" toggle inside `CitationsPanel` switches from the
existing flat-list view to the graph — same underlying first-ring data either way.

### Conversational/agentic search

`understandQuery()` (`lib/ai/queryUnderstanding.ts`) turns free-text input into either
`{action: "search", query, mode}` or `{action: "clarify", question}` via a non-streaming
`provider.complete()` call (`models.cheap` — a fast classification/rewrite task) with a system
prompt instructing strict JSON output. **Defensive by design**: the provider not being
configured, the call failing, or the output not parsing into a valid shape all fall through to
treating the raw input as a literal keyword query — this must never become a hard failure in
front of search, the same graceful-degradation contract as every other AI feature. `POST
/api/query-understanding` (POST — triggers a real LLM call) accepts `{input, priorTurns?}` —
mirroring `/api/chat`'s no-server-persistence convention, the client resends prior clarification
rounds itself rather than a new session store being introduced. `SearchBar` tries this on
submit; on `clarify`, shows the question inline and loops; on `search` (or any failure),
navigates via the existing `router.push('/?q=...&mode=...')`, unchanged from Milestone 2.

### Multi-paper synthesis chat

`/api/chat`'s body gained `works: {workKey, title, abstract}[]` as an alternative to `context`
— **client-supplied, not server-looked-up**: `SearchExperience`/`ResultList` already hold this
data client-side (abstract included) from the search response, so a new server-side
`work`-table read for 8–50 works per request would be the first AI feature depending on a DB
read with no defined graceful-degradation behavior, racing `persistWorks()`'s fire-and-forget
upsert for no benefit. `buildSynthesisContext()` (`lib/ai/synthesisContext.ts`) embeds the
question via the existing `embedQuery()`, gets-or-computes each work's embedding via the
existing `getOrComputeEmbeddings()`, ranks by the existing `cosineSimilarity()`, and formats the
top ~8 as titled context blocks — exact reuse of `semanticRank.ts`'s building blocks, no new
pattern. The route always derives ranking from `messages[0].content` (the original synthesis
question), never the latest message — deterministic and idempotent given pure/cached math, so
turn 5 recomputes the same top-8 turn 1 got with no extra LLM cost and no selection state to
persist across turns. If ranking itself fails (the embedding backend down), a naive
first-8-unranked fallback is used rather than failing the whole chat request. A "🧬 Synthesize
across these results" entry point above the result list reuses `ChatPanel`'s exact streaming-
consumption logic (generalized to accept either `context` or `works`).

### Citation reasoning

"Who built on whom, and why" for one specific citation edge. `getSemanticScholarAbstract(doi)`
(`providers/semanticscholar/citations.ts`) is a **targeted single-paper lookup, deliberately not
added to `CitationRef`/the bulk citing-/references-list `fields` param** — that would fetch and
cache an abstract for every edge in a possibly-hundred-item list when only the one edge a user
clicks into ever needs it (and OpenCitations has no abstract data at all, so the field would be
permanently null there regardless). `citation_reasoning_cache` is keyed by the normalized
`(citingDoi, citedDoi)` pair — **permanent, no TTL**, mirroring `work_ai_summary`'s shape rather
than `citation_cache`'s 1-week TTL, since a specific pair's abstracts and the LLM's
characterization of their relationship don't change the way a citation _list_ does; normalizing
regardless of which paper was "root" when asked means the same edge viewed from either paper's
graph hits the same row. `getCitationReasoning()` looks up both papers' abstracts (the root via
the `work` table if present, the other side via the targeted lookup above) and calls
`provider.complete()` (`models.cheap`) for a relationship explanation. If either abstract is
unavailable, returns a clear "not enough information" decline rather than reasoning from titles
alone — verified live: given two real but topically-unrelated papers' abstracts, the model
correctly reported it couldn't establish a clear relationship rather than fabricating one. `POST
/api/citations/reasoning` (POST — real LLM call on a cache miss). In `CitationGraph`, clicking
an edge (not a node) triggers this and shows the explanation inline.

## Frontend

### Shell and design system (sub-project #1, the visual redesign)

The palette lives in one place: CSS custom properties in `app/globals.css`, mapped into
Tailwind utilities through `@theme inline` (so components say `bg-surface` / `text-muted` /
`border-line`, never `zinc-900` / `blue-700`). It is **dark-first** — the dark values are the
defaults on `:root`, and a `prefers-color-scheme: light` block redefines the same token names
for light mode. Because the palette switches at the token level, components carry no `dark:`
variants for anything the tokens cover; the only remaining ones are inside `prose` (typography
plugin) classes. There is no in-app theme toggle — the app follows the OS preference.

`TopNav` (`components/nav/TopNav.tsx`) is rendered from the root layout on every page, inside a
`<Suspense>` boundary because it reads the query string (`useSearchParams`, which opts its
subtree out of prerendering). It carries the wordmark, a compact search input that appears
**only** once a query is active, and the nav items (`Search`, `Library` — inert, labelled
"Soon", until the accounts/library sub-project, `Health`, and an inert avatar placeholder).

With no query, `app/page.tsx` renders `HomeHero` instead of a result page: one large task
input (`SearchBar variant="hero"`) plus a quick-action row. Two of those actions are real —
`Search papers` submits the box, and `Literature review` submits it with `?view=review`, which
`SearchExperience` passes down so `ResultList`'s multi-paper synthesis `ChatPanel` opens
already expanded. `Draft` / `Diagrams` / `Presentation`, like `Tools ▾`, are inert placeholders
for later sub-projects. The homepage's big box and the navbar's compact input are never on
screen at the same time: the hero renders only when no query is active, the compact input only
when one is.

One visual device carries information rather than decoration: each `ResultCard` shows a
**provenance spine** — nine ticks, one per aggregated source, lit for the sources that actually
returned that record (cross-source agreement is a real ranking factor, so the spine reads as a
compact visualization of it), with the full source list in its tooltip. The wordmark reuses the
same nine-tick motif.

### Data flow

`app/page.tsx` is a Server Component: when `?q=` is present it calls `performSearch()`
directly (no self-fetch network hop) so initial HTML contains real results (SEO + fast first
paint), wrapping a client island (`SearchExperience`) that owns filter state. A new search
query is a real Next.js navigation (`?q=...`), not a client fetch — the page just re-renders
with fresh SSR data; filters (year/OA/citations/source) are applied instantly client-side over
the already-fetched result set via the same `filterWorks()` used server-side (see "API
contract" above). Accessibility: semantic landmarks, native form controls in the filter
sidebar, `aria-live="polite"` for the result count, and three distinct `EmptyState` variants
— all-providers-down, genuine zero-results, and filtered-to-nothing are never conflated.
`app/loading.tsx` provides the loading state during SSR navigation, respecting
`prefers-reduced-motion`.

`SearchBar` has two variants — `hero` (the homepage task box, a textarea: Enter submits,
Shift+Enter adds a line) and `compact` (the navbar pill) — sharing one submit path, and keeps
its keyword/semantic mode toggle (`?mode=semantic` in the URL, so it's bookmarkable/shareable
like everything else; rendered as two pill-styled radios rather than bare radio buttons) plus (Milestone 3) a conversational-search layer:
every submit first tries `POST /api/query-understanding`, showing a clarifying question inline
and looping if asked, or navigating once a query+mode is resolved (or the call fails/degrades,
in which case it navigates with the literal typed input — unchanged from Milestone 2 behavior).
Each `ResultCard` gets three AI-feature affordances, all client components that fetch on demand
rather than eagerly (cost/latency): `SummaryButton` (fetch-on-click, graceful message on a
503-disabled response), `CitationsPanel` (native `<details>` — accessible/keyboard-operable and
a plain disclosure with no JS, enhanced with an on-expand fetch, with a Milestone 3 "Graph view"
toggle rendering `CitationGraph`), and `ChatPanel` (closed-by-default disclosure, streams the
assistant's response into a growing transcript via `response.body.getReader()` — generalized in
Milestone 3 to accept either single-paper `context` or multi-paper `works`, reused by both
`ResultCard`'s "Ask about this paper" and `ResultList`'s "Synthesize across these results").

## Document ingestion (sub-project #2)

The first capability in this app that sees full paper text rather than a provider's abstract.
Deliberately headless — there is no page, no upload widget, and no route rendering a document;
#3 builds the first UI on top of it.

### Storage

`BlobStore` (`lib/storage/blobStore.ts`) is a three-method interface — `put`, `get`, `delete` —
with one implementation, `localDiskBlobStore`, selected through `getBlobStore()`. This is the
same adapter-behind-a-selection-point shape as `getActiveEmbeddingProvider()` and
`getActiveLlmProvider()`, so adding an S3/R2 store later touches `lib/storage/index.ts` alone.

Blob keys are the document id, and are validated against `^[A-Za-z0-9_-]{1,128}$` before ever
being joined to a path. That is an allowlist of the exact shape the app generates, not a
sanitiser — path-traversal sanitising is a blocklist game that eventually loses, whereas a key
that isn't the shape we mint is simply rejected.

### Two-phase ingestion

`POST /api/documents` runs phase 1 synchronously: validate size, check the `%PDF-` magic bytes
(_not_ the declared Content-Type, which is attacker-controlled in a multipart upload), hash,
store the bytes, extract text, chunk, and insert with `status: 'parsed'` and null embeddings.
It targets a few seconds for a normal paper.

Phase 2 is `ensureIndexed(documentId)`, which embeds any chunk lacking a vector for the
_currently active_ model. It is fired un-awaited right after phase 1 so the common case is
already warm, and called again defensively by `retrieveChunks`, so a missed or failed run
self-heals on first use.

There is deliberately no terminal failure status. A rejected upload persists no row at all and
its blob is deleted; a phase-2 failure returns the row to `parsed` so the next call resumes
from whatever chunks are still missing. This is why `document.status` is only
`parsed | indexing | indexed`.

A job table and a worker process were considered and rejected: a second runtime for exactly one
job type, when the job is idempotent, resumable, and cheap to retry on demand.

### Chunking

`lib/pdf/chunk.ts` is pure. Pages are normalized (hyphenated line-break rejoining, hard-wrap
collapsing, whitespace runs), concatenated with a parallel page index, and split at ~1400
characters preferring a paragraph break, then a sentence end, then a space, with 200 characters
of overlap so a sentence straddling a boundary stays retrievable from either side. Every chunk
records the page range it spans, which is what makes `[page 7]` citations possible in #3.

The parallel page index is why a chunk can span a page boundary without special-casing:
chunking strictly per page would produce chunks ranging from a title page to a dense 4000-
character one.

### Retrieval

`retrieveChunks(documentId, query, topK)` is the single contract #3 and #7 depend on, and is an
internal function rather than an HTTP endpoint on purpose — exposing raw retrieval would let
anyone holding a document id page through an entire copyrighted PDF a chunk at a time.

It ranks by cosine similarity over embedded chunks, and falls back to term-overlap scoring when
embeddings are missing or the query embedding fails, so a freshly uploaded document is usable
before indexing finishes. The fallback is a deliberately simple floor, not a competitor to the
vector path.

### Ownership

A signed cookie, `scholastic_sid`, carries `<sessionId>.<hmacSha256(sessionId, SESSION_SECRET)>`.
The document id itself is 24 random bytes, base64url — a capability token.

Ownership is enforced in the `WHERE` clause rather than by fetching and then comparing, so a
document belonging to another session is indistinguishable from one that does not exist and
every route can safely answer **404, never 403**. A 403 would confirm that an unguessable id is
real, which defeats the point of the capability.

When `SESSION_SECRET` is unset the HMAC key is a random value held on `globalThis`, not in a
module-level variable. That is load-bearing: Next bundles Route Handlers and Server Components
into separate module graphs, so a module-scoped fallback is minted once per graph, and a cookie
signed in `POST /api/documents` then fails to verify in the `/reader/[documentId]` Server
Component — which answers 404 to the very session that uploaded the file. Same reasoning as the
connection reuse in `lib/db/client.ts`.

### The one place the degradation contract does not hold

Every other database-backed path in this app is an accelerator that degrades to "no cache".
An upload has nowhere else to put its chunks, so `POST /api/documents` returns a 503 when
Postgres is unreachable rather than pretending to succeed. This is the app's first real
exception and is recorded in `KNOWN_LIMITATIONS.md`.

## Chat with PDF (sub-project #3)

### One route, four context sources

`/api/chat` resolves `context` (a single paper's title and abstract), `works` (the current
result set, ranked by `buildSynthesisContext`) and now `documentId` (an uploaded PDF). They are
mutually exclusive and the route says so with a 400 that names the conflict; before #3, `works`
beat `context` implicitly by ordering, which was fine for two sources and genuinely ambiguous
for three.

The document branch re-resolves ownership from the signed cookie rather than trusting the id in
the body, and answers 404 for an unowned document exactly as `/api/documents/*` does.

### Ranking against the latest message, not the first

The synthesis branch ranks against `messages[0]` on purpose: the paper set is fixed and the
topic is the original search query, so every turn recomputes an identical top-8 for free.

That argument does not survive the move to a single document. "What dataset did they use?" and
"what do the limitations concede?" are questions about different pages of the same paper, so
document chat ranks against the **latest** user message. Both comments sit next to each other in
the route so the apparent inconsistency is not "fixed" back into a bug.

### Page citations

`buildDocumentContext` prefixes each retrieved chunk with `[page N]` (or `[pages N-M]` — a chunk
can span a page boundary). That header is the only reason the model can cite a page at all.

`splitPageCitations` parses `[p. N]` back out of the answer. It is a pure string-to-structure
function specifically so it is testable in this repo's node-only vitest, and `ChatPanel`
substitutes the chips _inside_ markdown's rendered leaves rather than splitting the string
first — splitting first tears a bulleted answer into one list per bullet.

The system prompt makes the model separate "the retrieved excerpts don't cover this" from "the
paper doesn't say this". Retrieval returns excerpts, so only the first claim is defensible.

### The reader surface

`/reader` is the upload drop zone plus this session's documents — the first user-facing entry
point #2's endpoint has. `/reader/[documentId]` is a Server Component that settles ownership
before any client JavaScript runs, then renders `ReaderWorkspace`: `PdfPane` and an embedded
`ChatPanel` side by side, collapsing to tabs below `sm`.

`PdfPane` uses `react-pdf`, dynamically imported with `ssr: false` from inside a Client
Component (the only place Next honours that flag). It keeps a live canvas only within two pages
of the viewport, with proportional placeholders elsewhere, because #2 permits 500-page uploads.
The pdf.js worker is copied into `public/` by `scripts/copy-pdf-worker.mjs` at postinstall
instead of being fetched from a CDN — a page rendering user-uploaded documents should not reach
a third-party origin, and the reader should work with no network.

`retrieveChunks` would index inline and block the first turn for as long as embedding takes, so
the workspace polls `GET /api/documents/[id]` and keeps the composer disabled until the document
reports `indexed`. Chat is only ever reachable warm.

## Quick-win tools (sub-project #4)

### Citations are deterministic on purpose

No LLM touches citation generation. Everything runs client-side from the `CanonicalWork` the
card already holds, because there is nothing to fetch and nothing to infer.

CSL-JSON (`lib/citations/csl.ts`) is the intermediate representation: it is what every reference
manager already speaks, it makes BibTeX and RIS export nearly free, and #8's auto-citation will
consume it directly rather than re-deriving the mapping from `CanonicalWork`.

Each style is a hand-written pure function of about forty lines rather than citeproc-js, which
would need style XML and a locale bundle — hundreds of kilobytes and an asset-loading problem —
to support four styles. Hand-writing them also means owning the edge cases deliberately: APA's
twenty-one-author ellipsis, Chicago's comma before "and" when the first name is inverted,
corporate authors that must never be initialised, `n.d.` for a missing year, preprints with no
volume by definition.

Completeness is reported, never hidden. `findMissingFields` returns what a style needed and
didn't get, and the UI renders the citation it can produce alongside a note naming the gap. The
export formats are exempt: BibTeX and RIS are lossless containers, so a sparse entry is a
faithful record rather than an incomplete citation.

### `pickBibliographic`: the one whole-block picker

`lib/merge/reconcile.ts` picks each canonical field independently — longest abstract, the
author list with the most ORCIDs, the modal year. That is right for those fields and wrong for
bibliographic detail, where volume, issue and page range are only meaningful together.

So `pickBibliographic` takes the block whole, from the single highest-priority source in the
cluster that carries a non-empty one, using the existing `PUBLISHED_SOURCE_PRIORITY` ranking.
No merging. If no source has one the result is null and the citation is marked incomplete
rather than partially filled from three places.

### Find topics: aggregate deterministically, label with a model

`aggregateTopics` frequency-and-confidence ranks the concepts OpenAlex already returns in a
payload the mapper used to drop. That step is deterministic and free. `labelTopics` then makes
**one** call to cluster and name those candidates.

`keepOnlyKnownConcepts` is the guard that makes this honest: any concept the model returns that
wasn't in the input is dropped, and a theme left empty goes with it. This is not cosmetic —
clicking a theme filters the result list by its concepts, so an invented concept would match
nothing and read as a bug in search.

With no LLM the panel shows the ranked concepts unlabelled: less polished, equally usable, no
error state. Topic narrowing writes to the same `SearchFilters` the sidebar owns, so the result
list narrows in place with no re-query.

### Rewrite: whose text it is decides the verb

The paraphraser rewrites the user's **own** prose. Rewriting a passage selected from the paper
on the left would be exactly the use the tool is scoped to exclude, so that surface gets a
different verb — ask about it in chat — and the panel says so.

Three prompt constraints are correctness requirements rather than style preferences: citation
markers survive verbatim (dropping "(Smith 2019)" destroys attribution), no claims are added,
and hedging is preserved. "may suggest" becoming "shows" is a factual error in academic prose
and is the failure a general-purpose rewriter produces most reliably, so the prompt names it.

It is not positioned, prompted, or documented as a way to obscure authorship or evade AI
detection. `ROADMAP.md` declines to build the detector because its accuracy claims are not
honestly supportable; shipping its evasion counterpart is the same problem from the other side.

## Accounts and the library (sub-project #5)

Accounts are optional in the same sense every provider and the LLM layer are: with no
`BETTER_AUTH_SECRET` the feature is absent, not broken. `/login` and `/signup` answer 503, the
nav shows no account menu, and the app behaves exactly as it did before #5.

`isAuthEnabled()` is a check, deliberately not a default. A generated fallback secret would
invalidate every session on restart — a worse failure than a feature that is visibly off, and
the opposite call from `SESSION_SECRET`, where the fallback keeps a strictly local feature
usable for the length of one process.

### One owner type, two kinds of owner

Everything that can be owned — an uploaded document, a saved paper, a collection — resolves
its owner through one function:

```ts
type Owner = { kind: "user"; userId: string } | { kind: "anonymous"; sessionId: string };
```

`resolveOwner()` (Route Handlers, may mint the cookie) and `readOwner()` (Server Components,
read-only) are the only two ways to answer "whose is this". A signed-in user's id wins over the
anonymous cookie whenever both are present. Because the ownership predicate stays in the
`WHERE` clause, #2's rule survives intact: someone else's row is indistinguishable from a row
that does not exist, and every route answers **404, never 403**.

### Adoption, and the `IS NULL` that is the whole security of it

Signing up or signing in claims the anonymous session's uploads for the new account, so work
started before you had an account is not stranded. The claim is a single `UPDATE` filtered on
`ownerSessionId = :sid AND user_id IS NULL`.

That `IS NULL` is not defensive; it is the entire security of the operation. Without it, a
second person signing in on a shared browser inherits the first person's documents, because
they share a `scholastic_sid`. For the same reason, signing out rotates the cookie rather than
merely clearing it.

Adoption runs in `afterAuthResponse`, reading the new user id from a **clone of the response**:
on a sign-in the session cookie exists only on the way out, so the request cannot tell you who
just signed in. Four cases are covered by end-to-end tests, since none of them exist below the
HTTP layer: upload-then-sign-up, upload-then-sign-in, a second account on the same browser,
and cookie rotation on sign-out.

### The data access layer

`lib/auth/dal.ts` holds `verifySession()`, wrapped in React `cache()` so a page that checks the
session and a layout that renders the account menu cost one lookup per render. It returns
`null` rather than throwing when auth is off or the lookup fails — a session check is not a
place to take the page down.

`lib/auth/dto.ts` builds `PublicUser` as an explicit whitelist. The user row grows fields over
time (verification state, provider metadata); a spread would ship each new one to the client
the day it is added.

API routes use `requireUserApi()`, which answers with a JSON 401 (or 503 when accounts are off)
rather than redirecting — the two surfaces need genuinely different answers, and a fetch that
follows a redirect to an HTML login page reports a confusing success.

### Rate limiting

Two tiers, because one number cannot do both jobs. The root layout calls `get-session` on every
page load, so a single tight limit locks out ordinary browsing — worse behind a NAT, where an
office shares one address. A flat 20/minute did exactly that, and the end-to-end suite tripped
it within one run. The global limit is now generous (120/minute); the tight rules apply only to
the credential endpoints, where brute force buys an attacker something.

There is no environment switch to disable it. `next start` sets `NODE_ENV=production`, so a
guard keyed on that would have been defeated by the very suite it was added for — and an escape
hatch that works under `NODE_ENV=production` is an escape hatch in production.

### Trusted origins

better-auth 1.7 rejects any origin it was not told about. A per-request function is not an
option: `getTrustedOrigins(options)` runs once at context creation, without a request. So the
list is resolved from `BETTER_AUTH_URL` plus `BETTER_AUTH_TRUSTED_ORIGINS`, with
`http://localhost:*` and `http://127.0.0.1:*` added **outside production only**, so `pnpm dev`
works on whatever port is free while production trusts only origins the operator named.

### Library storage

`saved_item` holds both saved search results and uploaded documents, discriminated by
`item_type` and constrained by a `saved_item_shape` CHECK — a work row must carry a `work_key`
and a document row a `document_id`, and the database refuses anything else. A saved paper keeps
a **snapshot** of the merged `CanonicalWork`: the providers it came from can change their
metadata, and a library that silently rewrites what you saved is not a library.

Uniqueness is enforced by partial unique indexes (one per item kind, since only one of the two
columns is non-null in each). Postgres requires the index predicate to be restated in
`ON CONFLICT`, which drizzle spells `targetWhere` — omitting it fails at runtime with 42P10,
not at compile time.

Duplicate collection names are detected by walking `err.cause` for SQLSTATE `23505`. drizzle
wraps the driver error in `Error: Failed query: …`, which carries neither the SQLSTATE nor the
constraint name, so a substring match on the message never fires and the user gets a 503 where
they should get a 409.

### End-to-end tests

Playwright arrives here rather than at the end of the sequence, because #5 is the first
sub-project whose correctness lives in things no unit test can see: cookies crossing a
redirect, adoption reading a response the request cannot, one browser holding two identities.
It paid for itself immediately by catching the rate-limit lockout and the invalid-origin
rejection, neither of which reproduces below the HTTP layer.

The suite runs against a production build (`next build && next start -p 3100`) with one worker.
Dev-server compilation on first hit blew past every reasonable timeout, and serial execution
keeps the credential rate limit measuring the code rather than the test runner.

## Credits and sponsorship (sub-project #6)

Credits are not a rate limiter in a game costume. They allocate a **shared, donated pool of AI
capacity** among researchers, and they are never purchasable, never transferable, and never
earned by using the app — farming a commons is farming other researchers.

### Three concepts, deliberately separate

| Concept      | What it is                              | Unit                     |
| ------------ | --------------------------------------- | ------------------------ |
| Capacity     | Real API keys and the quota behind them | provider tokens          |
| Credits      | A user's claim on that capacity         | credits                  |
| Contribution | What earns a claim                      | verified works / reviews |

Conflating them is the failure this design exists to avoid. Capacity is finite and externally
denominated; credits are an internal currency; contribution is what mints them. Keeping them
apart means the exchange rate can change without touching the ledger, and a capacity shortfall
never corrupts anyone's balance.

### The database never holds a key

`capacity_source.credential_ref` stores the **name of an environment variable**. The secret
lives in the environment like every other credential here. Sponsorship is therefore
operator-mediated — a sponsor offers capacity, the operator adds the key and records a row with
`pnpm capacity` — which is slower than self-serve and correct. A web form that accepts a pasted
API key is an explicit non-goal, written down here so it does not return later as a convenience
feature.

Selection prefers **sponsor capacity over operator capacity**, so donations are consumed rather
than sitting behind the operator's own key, then falls back to the static preference order. An
instance with no rows behaves exactly as it did before #6.

### Three ways to donate capacity

A key is the simplest kind of donation, not the only one. `lib/capacity/endpoints.ts` adds two
more, and the difference between them is custody rather than technology:

| Kind      | What the sponsor gives           | What we hold                        |
| --------- | -------------------------------- | ----------------------------------- |
| key       | An API key, out of band          | The **name** of an env var          |
| `outpost` | A scoped OpenAI-compatible relay | A URL, and a bearer token's env var |
| `node`    | GPU hours on a cluster they run  | A URL, a model id, and a schedule   |

An outpost exists for the institution whose grant terms forbid handing its key to anyone: it
keeps the key, enforces its own spend limits locally, and revokes access by switching the relay
off. A node donates the hours a cluster is otherwise idle — `active_hours_utc` wraps past
midnight, and is measured against the day the window **opened** on, so a weeknights-only
donation does not stop at Friday midnight or start on a Saturday nobody offered.

Neither adds a secret to the database. A node reachable only on a private network is the one
case where `credential_ref` may be null; for a keyed provider a null there means the row is
incomplete, and an incomplete row is skipped rather than tried.

### The dispatcher fails over

`selectCapacity` returns a provider that dispatches across the whole ranked pool, not a single
backend. A source answering 401, 402, 403 or 429 is tripped **dormant** — five minutes for a
rate limit, six hours for a key being refused, since that one needs a human — and the request
moves to the next source. Tokens are billed to whichever source actually answered, which is why
`MeteredLlm` reads `servedSourceId()` at usage time instead of capturing an id up front.

Two limits are deliberate. A 400 is not retried anywhere: it will fail identically on every
backend, and replaying it spends another sponsor's quota to learn nothing. And a **stream never
fails over once it has yielded a token** — splicing two different answers together mid-sentence
is worse than an honest error.

Each endpoint gets its own `withResilience` id (`outpost:mp-lab`), so one lab's relay going down
cannot open the circuit breaker on another's.

### The ledger is canonical

`credit_ledger` is append-only: one row per event, each carrying its reason and the balance it
produced. `credit_balance` is a materialized convenience written in the same transaction, and
`reconcile()` checks `sum(delta) == balance`.

A bare counter can tell someone _12_ but never _why 12_. In a commons, unexplainable accounting
is a trust problem rather than a UX one.

Each row stores the delta that was **actually applied** rather than the one requested, so a
spend clamped at zero still reconciles exactly; the intended amount is kept in `detail`. Grants
carry an idempotency key enforced by a partial unique index — `welcome`, `replenish:2026-09`,
`work:<openAlexId>`, `review:<putCode>` — so re-running a grant awards nothing twice, and the
guarantee lives in the database rather than in a check-then-write race.

### Reserve, then reconcile

`recordUsage` was already documented as non-blocking and error-swallowing: "must never affect
the response." Debiting has to be reliable. Both hold, because they happen at different moments:

1. **Pre-flight** (blocking, before the call): compare the balance to a conservative estimate
   and refuse _before_ anything is spent. This is the only place credits can block a request.
2. **Debit** (non-blocking, on completion): the usage callback writes the `spend` row with real
   token counts. A failure is logged and dropped.

The asymmetry is deliberate. A dropped debit undercharges by one operation; a debit that breaks
a response the user already received is a bug they experience. Pre-flight bounds how much
undercharging can accumulate.

`lib/credits/metered.ts` is the single seam: it selects capacity, runs pre-flight, and returns
the `onUsage` callback. Every metered feature goes through it, which is also what made the
call sites testable — the six of them used to reach for a provider and a usage recorder
separately.

Streaming needed work to make this true at all: `streamComplete` reported no usage, so chat and
rewrite — the two most expensive features — would have been free. The OpenAI-compatible backends
now ask for `stream_options: { include_usage: true }` and read the final usage frame; Anthropic's
counts are assembled from `message_start` and `message_delta`. A backend that reports nothing is
simply not charged, which is the same undercharge-rather-than-guess rule.

### What is free, and what a refusal says

Search, dedupe/merge/rank, filtering, citation formatting, the citation graph, PDF reading,
saving and collections are **free forever** — they cost no incremental money and they are the
product. Only model calls and hosted embeddings are metered; local transformers.js embeddings
cost CPU, not money.

Two rules follow from that: the cost of an expensive action is shown **before** it runs (the
`CostHint` beside each control, reading the same table the server charges against), and the
debit happens on successful completion using actual tokens, so a failed or refused call is never
charged.

A refusal answers **403, not 402**. Payment Required is the obvious status and the wrong one:
nothing here is purchasable, and a status meaning "pay to continue" would misdescribe the whole
system. The body carries `reason: "insufficient_credits"` plus the estimate and balance, and the
message names what still works — an empty balance must not read as a broken app.

### Degradation

| Condition            | Behavior                                          |
| -------------------- | ------------------------------------------------- |
| Accounts disabled    | Credits off entirely; the instance is unmetered   |
| Postgres unreachable | **Fail open** — AI features run unmetered, logged |
| No sponsor capacity  | Operator capacity serves everyone                 |
| A source 429s        | Tripped dormant; the request moves to the next    |
| A node off-schedule  | Out of the pool until its window opens            |
| No capacity at all   | The existing 503, unchanged                       |
| Balance at zero      | The free surface stays fully usable               |

Fail open is a chosen trade-off. A commons that refuses service because its bookkeeping is
offline is worse than one that occasionally undercounts.

### Anonymous visitors

They have no identity that can hold a balance, so they hold none — a flat per-browser allowance
keyed on #2's `scholastic_sid`, drawn **only from operator capacity**. Without an allowance,
"use it logged out" is the hole that makes the whole system decorative; without the operator-only
restriction, sponsors would be funding an unauthenticated firehose.

### Earning, and why it needs OAuth

| Source                | Amount                           | Idempotency           |
| --------------------- | -------------------------------- | --------------------- |
| Welcome grant         | generous, published, env-tunable | one per account       |
| Monthly replenishment | tops **up to** a floor           | `replenish:<yyyy-mm>` |
| Verified publication  | per indexed work, diminishing    | `work:<openAlexId>`   |
| Verified peer review  | per review record                | `review:<putCode>`    |

The monthly figure tops a balance up to a floor rather than adding to it, so credits cannot
accrue through inactivity. Publications past a threshold earn a halving rate with a floor of 1:
a prolific senior author should not accumulate a claim on a shared pool they cannot spend while
an early-career researcher runs dry. That is a fairness decision, written as a curve rather than
buried in a constant.

Ownership of an ORCID iD is proven by **ORCID OAuth**, using the `/authenticate` scope — the
smallest one that answers the question. A self-asserted iD typed into a box proves nothing and
would let anyone claim a prolific author's record. The access token is discarded immediately:
publications come from OpenAlex (already a configured provider) and reviews from ORCID's public
API, neither of which needs one. One iD maps to one account, enforced by a unique index.

Grants run when the user asks, not on a schedule. A background job that silently moved someone's
balance would be harder to explain than a button they pressed.

### No leaderboard, ever

`/credits` is private; `/sponsors` is public and carries no per-user data. There is no
leaderboard, badge, profile, or comparison surface anywhere, and that is a hard constraint
rather than a v1 simplification. A credit score attached to a researcher and shown publicly is a
reputation metric, and academia's existing reputation metrics have a well-documented history of
being gamed — citation cartels, salami publishing, coercive citation. Keeping balances private
removes the incentive structurally instead of policing it.

## Extracted data and evidence matrices (sub-project #7)

Pull the numbers out of papers, **with provenance**. Two surfaces over one
primitive: per-document extraction in the reader, and an evidence matrix whose
rows are documents, columns are fields the researcher types, and cells are
extracted values.

### Two extractions, because they are two different problems

Tables are **geometry**. Prose statistics are **semantics**. Treating them as
one problem — flattening a page to text and asking a model for structure — is
exactly how a number ends up in the wrong row, because pdfjs emits text items in
draw order rather than reading order, so a two-column numeric table arrives
interleaved.

`lib/pdf/tables.ts` is pure and sees no model: it groups positioned items into
lines by baseline, finds runs of lines that split into column groups, clusters
start-x **and** end-x (a right-aligned numeric column has no shared left edge —
clustering start-x alone scatters `1.2`, `10.4` and `100.9` across three
boundaries), assigns cells, and reads the caption off the nearest `Table N` line.

`confidence` is computed from three measurable properties of the result:
occupancy, row-to-row consistency, and **cell brevity**. The third exists
because of a specific false positive: a page of two-column prose is perfectly
occupied and perfectly regular, so the first two score it 1.0 and it surfaces as
a confident table. Cell length is what actually separates a datum from a
sentence. False-positive detection is the main risk in this design, and it has
its own fixtures.

Findings come from an LLM call over #2's retrieved chunks rather than the full
text, which is mostly irrelevant to the fields being sought and expensive to
send.

### The non-invention guard

This is the load-bearing part, and both halves are mechanical — so "the model
never invents a number" is a property of the code rather than a hope about a
prompt.

**Interpretation may relabel, never re-value.** One cheap-tier call per table
returns which row is the header, a unit per column, and a one-line description —
never cell values. Every unit it returns is checked against the grid; anything
absent discards the _whole_ interpretation and the raw grid stands unlabelled. A
response that invented one unit has demonstrated it is not doing the task, and a
partially-trusted interpretation is harder to reason about than none.

**Every finding must quote its source**, and the value must appear inside its
own quote. The second check is the one people forget: a quote can be perfectly
genuine while the value beside it was inferred — "we recruited participants
across three sites" cited for a sample size of 412 — and that reads as
provenanced when it is not.

### `not_reported` is a first-class status

The single most important property of an evidence matrix is that a blank cell
means _this paper does not report that_ and never _the extractor gave up_. Three
statuses, rendered distinctly, with a CHECK constraint that makes a `found` cell
without a page and a quote unstorable.

A cell that claims `found` but cannot be quoted degrades to `not_reported`
rather than to an error: the excerpts were read, and an unquotable answer is
indistinguishable from the field being absent. Presenting it as a value is the
one outcome that is never acceptable.

### One cell, one call

A cell is filled by one `retrieveChunks(documentId, label)` plus one LLM call
scoped to that (document, column) — never one large call per paper. The
consequences are the reason: cells fill in parallel under a small concurrency
limit, a failure is one cell rather than a row, and re-running a single column
touches nothing else, so refining one field's wording does not mean paying to
redo the grid.

Under #6, table geometry is **free** and everything else is metered. A fill is
two requests — `GET` prices it, `POST` performs it — because a 20×6 matrix is
120 provider calls and the user is told that before clicking.

### Ownership and export

Matrices carry a nullable `userId` beside an `ownerSessionId` and are adopted on
sign-in by the same `user_id IS NULL` UPDATE as #5's documents. An unowned
matrix answers 404, never 403.

The CSV export carries the provenance, not only the values: every found cell
exports its page and its verbatim quote beside the value, and `not reported` is
written out in full rather than left blank — a blank cell in a spreadsheet reads
as missing data, when it is a finding about the paper. A CSV of bare
model-extracted numbers is precisely the artefact that should not exist: it
looks like data and cannot be checked.

Fields are also neutralised against formula injection. A value legitimately
beginning with `-` (a negative effect size) or `=` executes when the file opens
in Excel, so it is prefixed with a tab and quoted rather than mangled.

## The AI writer (sub-project #8)

A manuscript editor whose citations are live objects rather than typed text,
with a small set of AI operations that assist the writer without writing for
them.

### A citation node stores one attribute

```ts
Node.create({
  name: "citation",
  inline: true,
  atom: true,
  addAttributes: () => ({ workKey: { default: null } }),
});
```

No number. No author-year string. Nothing about how it renders. Everything
useful follows from that single decision: reordering paragraphs renumbers,
switching APA to MLA is a re-render rather than a rewrite, deleting a sentence
removes its bibliography entry, and the same work cited twice produces one
entry. It is also the entire reason this uses ProseMirror rather than a markdown
textarea.

The rendered label is derived from document order and the active style, pushed
into the node as presentation-only state and never persisted as meaning. The
relabelling transaction sets `addToHistory: false`, because derived state must
not consume a step of the writer's undo stack.

### The bibliography is derived, never stored

Walk the doc, collect `workKey`s in first-appearance order, dedupe, resolve,
format through #4's formatters. Zero new formatting code — which is why a style
switch here can never disagree with a Cite popover there.

Resolution order is `saved_item.workSnapshot`, then the `work` table. The
snapshot comes first because `persistWorks` is un-awaited best-effort and the
`work` row may be stale or missing, and a manuscript is exactly the consumer
that cannot tolerate a bibliography entry changing under it.

A key that resolves to nothing renders as a **visible broken-citation marker**,
inline and in the bibliography. It is never silently dropped: a citation that
disappears leaves the claim standing without its attribution, which is a
plagiarism risk rather than a rendering bug.

A manuscript's style is one of APA, MLA or Chicago. BibTeX and RIS are
interchange formats with no inline label — offering them as a manuscript style
produced a markdown export whose references section was a list of `@article{...}`
entries.

### The AI never attaches a citation

Find support ranks the user's library semantically, then live search, and
requires an explicit pick. There is deliberately no confidence threshold above
which it inserts on its own. A wrong citation is worse than no citation: it
reads as authoritative, it is rarely re-checked, and it survives into the
published version.

### One generative mode, mechanically constrained

The grounded draft writes a related-work paragraph from sources the user chose,
reusing `buildSynthesisContext` unchanged. The model writes citations as
`[[workKey]]` — unambiguous in prose and trivially parseable, unlike an
author-year string that would have to be matched back and could match the wrong
work.

Then `validateDraft` runs, and it is the same guard pattern as #7:

- a sentence with no citation is stripped;
- a citation naming a work outside the supplied set is stripped, along with its
  marker;
- the two compose, so a sentence whose only citation was foreign goes too;
- if that empties the draft, nothing is inserted and the user is told why.

Inserting unattributed prose into someone's manuscript is the failure this
prevents, and it is prevented in code rather than in a prompt.

This drafts a literature summary from chosen sources with attribution on every
sentence. It is not a ghost-writer for arbitrary academic prose — the same
reasoning on which `ROADMAP.md` declines to build an AI detector.

### Accounts required, and only here

`manuscript.userId` is `NOT NULL`. Everywhere else in this app a browser-scoped
identity is a convenience; for a manuscript it is a data-loss trap dressed as
one, because a cleared cookie would take the writing with it. `/write` explains
that rather than redirecting.

Autosave is debounced at just over a second. Revisions snapshot the document as
it was **before** a save — what a writer wants back is the state they lost — at
most every five minutes, capped as a ring of twenty.

### Free without a model

The editor, citation nodes, the derived bibliography, style switching and all
four exports work with no LLM configured. Only rewrite, tighten, explain, find
support and the grounded draft are metered. That leaves a genuinely usable
citation-managing writer with zero AI, which is a design target rather than an
accident.

LaTeX's `\cite{}` keys and its `.bib` keys are both `bibtexKey(toCsl(work))`, so
they cannot drift — the one way a LaTeX export usually breaks. The two files
ship in one response separated by a comment banner, rather than adding a zip
dependency for one format.

## The citation-graph explorer (sub-project #9)

The graph was a 520px canvas inside one result card's `<details>`, seeded from
one paper and expanded by right-clicking. It worked, and it was a curiosity
rather than a research tool.

### The refactor is the feature

`src/lib/graph/` existed and was empty; all 317 lines of logic lived inside
`CitationGraph.tsx`, where none of it could be tested. That is inverted before
anything was added:

| Module                  | Contents                                              |
| ----------------------- | ----------------------------------------------------- |
| `lib/graph/model.ts`    | Types, `endpointId`, the node budget. No React.       |
| `lib/graph/identity.ts` | Citation ref → `workKey`, with the unresolved path    |
| `lib/graph/build.ts`    | Refs to nodes/links, dedupe, capping, merge, seeding  |
| `lib/graph/analysis.ts` | Components, in-degree, shortest path, year layers     |
| `lib/graph/filter.ts`   | Year range, minimum degree, collapse, hide unresolved |

`CitationGraph.tsx` is now a renderer over those modules, and 48 tests cover
behaviour that previously had none. Everything below was only safe to attempt
because of that.

One thing the refactor had to preserve: `react-force-graph-2d` treats a new
`graphData` object as a changed graph and reheats the d3 simulation forever, so
`mergeGraph` returns the **same array references** when nothing changed. A test
asserts the identity directly rather than trusting the comment.

### Node identity

`nodeIdFor()` is gone. Nodes carry the app's own `workKey`. Most citation refs
have a DOI, and `doi:<normalised>` needs no lookup at all, so the feared
per-node lookup cost largely does not exist. A DOI-less ref gets
`unresolved:<hash(title|year)>` and `resolved: false` — one id shape carrying a
flag, not two id shapes.

The `unresolved:` prefix is deliberately not the app's `title:` shape: that
means "a work we have seen and normalised", and letting an unresolved reference
claim it would be a lie about what we know.

Because the graph speaks the app's identity, a node in the viewer's library gets
a marker and the inspector offers the same affordances as the rest of the app,
with no new plumbing.

### Interaction

Right-click to expand was undiscoverable and impossible on touch — the tell was
that the component explained it in a paragraph of prose. Now: click selects and
opens the inspector, double-click or Enter expands, Escape deselects, arrow keys
walk the edges, and the doi.org jump is an explicit link in the inspector rather
than the default click action. That fixes what the old hover comment conceded —
that clicking a node navigated away rather than letting you "just look".

A `<canvas>` graph is invisible to a screen reader, so the same nodes and edges
render as real DOM inside a `<details>` disclosure, with the same select and
expand actions.

### The cap is a budget

Reaching 150 nodes used to print "expand a different branch" with no mechanism
for doing so. Now there is collapse (removing only descendants reachable
_exclusively_ through the collapsed node — anything with another parent
survives, or the collapse would be destructive rather than a view change),
filters on year range, minimum in-degree and unresolved nodes, and a continuous
counter.

Roots always survive a filter, and a node with no year survives a year filter:
missing metadata is not evidence of a date outside the range, and dropping it
would hide exactly the under-linked work the coverage caveat is about.

### Multi-root

`/graph` seeds from one paper (`?work=`), a collection (`?collection=`), or a
result set (`?from=search&q=`). Edges are drawn between roots wherever citation
data connects them, and that is the actual value of the form: seeing that four
of twenty results all cite the same 1998 paper.

Seeding takes references **round-robin** across the roots. Draining seed one
before touching seed two spends the whole 150-node budget on the first two
papers, which defeats the multi-root form entirely; shared ancestors cost
nothing extra because they dedupe.

### Analysis, and the honesty constraint

`connectedComponents`, `inDegreeWithinSet`, `shortestCitationPath` and
`yearLayers` are pure, deterministic and free. In-degree within the loaded set
is a different and often more useful number than a global citation count: a
paper cited 40,000 times worldwide that nothing else in your reading list cites
is peripheral to the question you are actually asking.

**Every computed metric is labelled "within the loaded subgraph"** wherever it
appears. Citation coverage is incomplete and biased — OpenAlex, Crossref and
Semantic Scholar all have gaps, and preprints and non-English work are
systematically under-linked — so none of these numbers is presented as a
property of the literature.

That is also why LLM narration of clusters is refused. A generated paragraph
explaining what a cluster "represents" launders incomplete data into confident
prose. Edge-level citation reasoning stays: it is grounded in two specific named
papers. Set-level narration is not the same thing.

## The presentation builder (`/present`)

The homepage shipped with three quick actions labelled _Soon_. Two were already built and
unwired — _Draft_ is #8's editor, _Diagrams_ is #9's explorer, renamed _Citation map_ because
the citation graph is the only diagram this app draws. The third needed building.

### The same argument as the AI writer, in a shape where it matters more

`lib/deck/outline.ts` is the whole feature. It parses `## Slide title` / `- bullet` lines,
strips any citation naming a source the caller did not supply, deletes any bullet left without
one, and deletes any slide whose bullets all went that way. The three rules compose in that
order, the same way the manuscript drafter's two do.

It does not call `validateDraft`. A bullet is one claim that may run to two sentences, and
sentence-splitting it would strip the half that did not repeat the citation. What the two guards
share is the marker syntax — `CITATION_MARKER` is imported from `draftGuard`, not re-declared,
because two regexes for one wire format is how two guards drift apart.

The reason to be stricter here than in a manuscript: a slide is where an uncited claim travels
furthest. Nobody reads a projected bullet with a reference list open.

### The model is never shown a workKey

Sources go to the model tagged `S1..Sn`; `remapCitations` rewrites the tags to workKeys after
the guard has run.

This is not a cosmetic simplification. The first live run asked for exact keys the way #8 does,
and the guard deleted all six slides — 15 citations came back with a key one character wrong,
which is indistinguishable from an invented one. `doi:10.1038/nbt.3117` is a long punctuated
string that a language model paraphrases, hyphenates or truncates. A two-character tag is copied
correctly. The guard runs against the tags, so an unknown tag is gone before anything is
remapped, and the strictness is unchanged.

There is no embedding pass. The sources came back ranked for this exact query moments earlier,
and a second ranking could only disagree with the list the page is about to show.

### Marp, because a deck should still be a text file

`renderDeckMarkdown` emits `---`-separated slides with a Marp front-matter block: it opens in
any editor, renders in VS Code, converts to PDF or PPTX with one command, and diffs in git.
Inline labels come from #4's formatters through `inlineLabel`, and the reference slide from
`buildBibliography` — so a style switch re-renders rather than rewrites, exactly as in a
manuscript.

The numbers a bullet shows and the numbers in the references are both positions in
`collectDeckWorkKeys` order. Ordering the source list by search rank instead — the obvious
thing, since that is the order the search returned — would put a bullet's `[3]` beside a
different paper's `[3]`.

### Columns are bands, not clusters (a #7 correction)

`lib/pdf/tables.ts` used to find columns by clustering item start-x. That discards width, which
is the only thing separating a column gutter from an ordinary space: `O((log p)^3)` reaches
pdfjs as five items whose start positions are as far apart as two narrow columns', so a phantom
column appeared inside the cell and every value after the formula shifted one column right —
in a table the UI had already flagged low-confidence, feeding a wrong value into an evidence
matrix downstream.

`columnBands` projects every item's full span onto the x axis and merges spans separated by
less than a gutter. Alignment stops being a question the code has to answer, which is why the
left/right tie-breaker and `clusterPositions` are both gone.
