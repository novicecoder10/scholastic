# Known Limitations

This file tracks deliberate trade-offs and known gaps, so they're documented decisions
rather than surprises. Updated as the implementation progresses.

## Milestone 1 (Unified Multi-Source Search)

- **In-memory cache and circuit-breaker state are per-process.** On a single long-running
  Node server this is fine; on a horizontally-scaled or serverless deployment (e.g. multiple
  Vercel instances), each instance has its own cache and breaker state, so cache hit rate and
  breaker behavior are less effective than a single-instance deployment. The `search_cache`
  Postgres table is a durable complement, but true shared in-memory state would need a
  Redis-backed `CacheBackend` implementation (deferred; see `ROADMAP.md`).
- **Fuzzy dedup favors precision over recall.** The DOI-less matching threshold (Jaro-Winkler
  ≥ 0.92 on normalized titles, same year ± 1, same first-author surname) is intentionally
  conservative. This means an occasional true duplicate (e.g. a preprint and its published
  version, both missing/mismatched DOIs) may still show as two separate result cards, which
  is considered a better failure mode than incorrectly merging two distinct papers.
- **Ranking is a simple heuristic, not a learned or field-normalized model.** It weights
  log-scaled citation count, cross-source agreement, recency, and open-access status. It does
  not yet normalize citation counts by field of study (a 200-citation paper in a small field
  may be more significant than a 200-citation paper in a large one) or use query-term
  relevance scoring (e.g. BM25 over title/abstract). Documented as a v2 ranking target.
- **No streaming/progressive results.** `/api/search` waits for all providers to settle
  (bounded by a ~6s per-provider timeout) before responding, so worst-case latency when
  several providers are slow or down is roughly 6-8 seconds. This was a deliberate simplicity
  trade-off for Milestone 1 since dedup/merge/rank need the full result set to be correct.
- **Result totals are estimates, not exact counts.** Because deduplication happens across
  sources that each report their own (differing, sometimes approximate) total counts, the
  `totalEstimate` field is a best-effort figure, not a precise cross-source total.
- **Keyed providers are disabled, not simulated, without credentials.** If `CORE_API_KEY`,
  `UNPAYWALL_EMAIL`, or `NCBI_EMAIL` are unset, those providers simply don't contribute
  results — there's no mock/fallback data standing in for them.
