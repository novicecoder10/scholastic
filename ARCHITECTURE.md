# Architecture

## Overview

ScholarAI (Milestone 1) is a single Next.js (App Router, TypeScript) application. There is
no separate backend service: Next.js Route Handlers serve as the API layer, and Postgres
(with the `pgvector` extension enabled for future use) is the only external dependency.

```
Browser
  │  GET /?q=...                         GET /api/search?q=...   GET /api/health/providers
  ▼                                              │                        │
Server Component (app/page.tsx)                  ▼                        ▼
  │  (calls orchestrator directly,      Route Handler              Route Handler
  │   no network hop, for SSR)          (app/api/search/route.ts)  (reads health store)
  ▼                                              │
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
  ├─ OpenCitations
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
3. **Rank**: `score = 2.0·log10(citations+1) + 1.0·sourceAgreementCount + 0.8·recencyBoost + 0.3·isOpenAccess`.
   Citation count dominates (log-scaled so it doesn't totally drown out well-corroborated
   recent work), cross-source agreement is a proxy for "well-indexed," recency and OA get
   modest boosts. Intentionally simple — see `KNOWN_LIMITATIONS.md` for the v2 target
   (field-normalized citations, query-term relevance).

## API contract

`/api/search` returns **HTTP 200** whether some or all providers failed — provider failure is
an expected operational condition (`degraded: true`, per-provider `providerStatuses[]`), not
an application error. Reserve 5xx for genuine bugs (unhandled exceptions, DB failures writing
the cache). 400 is reserved for malformed requests (e.g. empty query). No streaming/SSE for
Milestone 1: dedup/merge/rank need the full all-settled result set to be correct, so the
response is a single JSON payload bounded by the per-provider timeout.

## Database

Three tables for Milestone 1 (`src/lib/db/schema.ts`): `search_cache` (durable complement to
the in-memory LRU), `provider_health_snapshot` (periodic persisted health/metrics), `work`
(canonical persisted records). The `pgvector` extension is enabled in the first migration even
though unused yet, specifically so embeddings can be added later without a disruptive
migration. Deferred: users/auth/saved-searches, `work_embeddings`, citation-graph edges.

## Frontend

`app/page.tsx` is a Server Component: when `?q=` is present it calls the orchestrator directly
(no self-fetch network hop) so initial HTML contains real results (SEO + fast first paint),
wrapping a client island that owns subsequent filter/pagination state. Accessibility: semantic
landmarks, native form controls in the filter sidebar, `aria-live="polite"` for async
result-count updates, and a distinct all-providers-down `EmptyState` versus a genuine
zero-results state.
