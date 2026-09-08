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
- **Ranking is a simple heuristic, not a learned or field-normalized model.** It combines a
  query-relevance term (token overlap between the query and title/authors/abstract/venue,
  weighted heavily so on-topic results always beat off-topic ones) with log-scaled citation
  count, cross-source agreement, recency, and open-access status as tie-breakers. It does not
  yet normalize citation counts by field of study (a 200-citation paper in a small field may
  be more significant than a 200-citation paper in a large one) or use a real relevance model
  (e.g. BM25 over title/abstract, or semantic/embedding similarity). Documented as a v2
  ranking target.
- **Relevance matching is keyword/token-based, not semantic.** A query like "gautam karat"
  (an author's name) correctly surfaces that author's actual papers first, but can also
  surface unrelated papers by _other_ people who happen to share one name token (e.g. a
  different author surnamed "Karat"), or papers using a query word as an unrelated common
  word (e.g. "karat" as in gold purity) — these still rank below genuine title/author matches
  but aren't excluded outright, since they do share a literal token with the query. This is
  expected behavior for a non-semantic keyword search engine (the same class of behavior any
  keyword-based search has) and is exactly what the mid-term semantic search milestone (see
  `ROADMAP.md`) is meant to improve on.
- **No streaming/progressive results.** `/api/search` waits for all providers to settle
  before responding (`Promise.allSettled`), so total latency is bounded by the _slowest_
  provider, not the average. With a 6s default per-provider timeout and 2 retries (3 attempts
  total), a single struggling provider can take close to 3× the timeout plus backoff delay —
  observed in practice against the live arXiv API (~17s on a slow response) — not just "one
  timeout's worth" as a naive estimate would suggest. This was a deliberate simplicity
  trade-off for Milestone 1 since dedup/merge/rank need the full result set to be correct;
  a slow-provider-specific shorter timeout/retry budget or streaming partial results (see
  `ROADMAP.md`) are the real fixes, not attempted here.
- **Result totals are estimates, not exact counts.** Because deduplication happens across
  sources that each report their own (differing, sometimes approximate) total counts, the
  `totalEstimate` field is a best-effort figure, not a precise cross-source total.
- **Keyed providers are disabled, not simulated, without credentials.** If `CORE_API_KEY`,
  `UNPAYWALL_EMAIL`, or `NCBI_EMAIL` are unset, those providers simply don't contribute
  results — there's no mock/fallback data standing in for them.
- **OpenCitations does not participate in the search fan-out.** Its public API is a
  citation-graph index queryable by known identifier (DOI/OMID), with no keyword-search
  endpoint equivalent to the other sources. Rather than fake that capability, it's deferred
  to the mid-term citation-graph-aware features phase (see `ROADMAP.md`), where it will
  enrich already-identified works rather than discover new ones from a query.
- **Unpaywall's `/v2/search` endpoint has observed reliability issues in live testing** —
  it returned a consistent `500 Internal Server Error` across repeated attempts during
  development, while their single-DOI lookup endpoint (`/v2/{doi}`) responded normally. This
  looks like an upstream issue with that specific endpoint, not our code (reproduced with a
  plain `curl`, independent of our adapter) — our resilience layer handles it correctly
  (retries, then marks the provider as failed, degrades gracefully). Worth rechecking if
  Unpaywall search failures persist; a fallback design (e.g. resolving OA status per-DOI for
  already-found works instead of using Unpaywall as a discovery source) is a candidate fix
  if this turns out to be permanent rather than transient.
- **PubMed is the slowest provider by design.** It requires three sequential/parallel
  E-utilities calls (ESearch for IDs, then ESummary + EFetch in parallel for metadata and
  abstracts), given a longer default timeout (10s vs. 6s) accordingly. This makes it the
  most likely provider to dominate worst-case request latency alongside arXiv.
- **No browser-based end-to-end test coverage.** The frontend was verified by inspecting the
  real server-rendered HTML output (correct titles, result counts, ARIA structure, live data
  wiring) rather than in an actual browser — no browser-automation tooling was available in
  the development environment. Client-side interactivity (filter sidebar re-filtering,
  search-bar navigation) is implemented but not automated-test-covered end-to-end; see
  `ROADMAP.md`'s note on Playwright coverage as a near-term follow-up.

## Milestone 2 (AI-Native Features)

- **Semantic search re-ranks the same keyword-retrieved candidate pool — it does not query a
  pre-built index over all of scholarship.** Building one is infeasible for a small app
  (OpenAlex alone is 250M+ works). This means `?mode=semantic` still depends on provider-side
  keyword retrieval to produce good candidates: a natural-language query only surfaces strong
  results to the extent it also contains tokens the providers' own search can match on.
  Verified live — a phrasing with weaker literal keyword overlap to the target topic produced a
  noticeably weaker candidate pool (and thus weaker semantic ranking) than a phrasing closer to
  the papers' own terminology, even though both were reasonable natural-language queries.
- **Local-embedding-backend latency is real and noticeable.** Without `OPENAI_API_KEY`,
  semantic search uses a local CPU-inference model (`@xenova/transformers`). Observed live: a
  query whose ~90 candidates were all new (uncached) took tens of seconds to embed; a repeated
  query reusing already-embedded candidates was near-instant. The hosted OpenAI backend would
  do the same work as a single batched API call instead. This is an accepted MVP trade-off of
  the "never require an API key" philosophy, not a bug — configuring `OPENAI_API_KEY` removes
  it entirely.
- **The embedding cache is a cross-query compute cache, not a searchable index.** `work_embedding`
  avoids recomputing a vector for a paper already seen in a _previous_ query, but semantic
  ranking still only ever considers the _current_ request's live candidate pool — it never
  performs a database-side similarity search over the full accumulated corpus. An hnsw index
  is present on the column for exactly this reason (cheap to add now, enables that mode later
  without a migration), but using it that way is a documented `ROADMAP.md` follow-up, not built.
- **A workKey hash collision between two genuinely different DOI-less papers is possible, if
  rare.** It requires byte-identical normalized title+year+first-author-surname+venue. The
  abstract-similarity guard in `workPersistence.ts` catches the case where both papers report
  an abstract and they clearly differ; if either lacks an abstract, there's no further signal
  available and the newer record is trusted as the same work. Mirrors the existing fuzzy-dedup
  precision-over-recall stance rather than being solved outright.
- **A DOI-less work later found again with a DOI now present mints a second, separate
  `workKey`/row rather than merging with the first.** Its embedding/summary/citation caches
  under the old key go stale rather than being reconciled with the new one. Same category of
  trade-off as the item above — accepted, not fixed.
- **AI summaries and chat have no local fallback.** Unlike embeddings, there's no offline
  substitute that approaches usable quality for summarization/conversational reasoning on
  typical hardware, so both features are simply disabled (a clear `503`, not a crash or a
  low-quality stand-in) without `ANTHROPIC_API_KEY`.
- **Chat has no persistence.** The full message history round-trips to `/api/chat` on every
  turn; there's no server-side conversation storage. This mirrors the existing "accounts/saved
  searches are out of scope" stance in `ROADMAP.md` rather than being an oversight.
- **Citation-graph enrichment is a per-work lookup cache, not a graph database.** There's no
  edge/traversal schema — `citation_cache` stores each source's raw citing/cited list per work.
  Sufficient for "what cites this, what does this cite" but not for graph-shaped questions
  (e.g. multi-hop citation paths) without further work.
- **OpenCitations' COCI API has uneven coverage and can be slow for heavily-cited papers.**
  Coverage is strongest for Crossref-registered DOIs and weaker elsewhere; in live testing, a
  request for a well-known, heavily-cited paper's citation list timed out at the default 6s
  provider timeout (retried, then gracefully excluded from the response — the Semantic Scholar
  source still contributed, and the response correctly reported `degraded: true` rather than
  failing outright). Also returns bare DOIs only, no titles/years — Semantic Scholar's
  citation-detail endpoints fill that gap where its own coverage overlaps.
- **No browser-based end-to-end test coverage for the new AI-feature UI**, for the same
  environment-availability reason as Milestone 1's frontend — verified instead via live API
  checks and server-rendered HTML inspection (correct button/panel counts, correct `workKey`
  wiring) rather than in an actual browser.

## Milestone 3 (Citation Graph, Conversational Search, Multi-Paper Synthesis, Citation Reasoning)

- **The citation graph is capped at ~150 total nodes.** Expanding nodes past that cap is
  disabled with an inline message rather than growing unbounded — a deliberate limit to bound
  an otherwise-unbounded lazy-fetch cascade (each node expansion is a live API call), not a
  quality signal about which papers matter more.
- **Multi-paper synthesis reasons over the current page of results (up to ~8, ranked by
  relevance to the question), not the whole corpus or "hundreds of papers."** It's real
  retrieval-augmented generation over what the search already surfaced, not a claim to have
  read everything Scholastic has ever indexed. Verified live to produce genuinely
  cross-referential answers (correctly distinguishing 5 different CRISPR papers by their
  specific technique) rather than describing one paper at a time.
- **Citation reasoning requires Semantic Scholar abstract coverage for the non-root side of a
  pair** (the root paper's abstract usually comes from the `work` table if it's been searched
  for; the other side almost always hasn't been, so it depends on S2's per-paper lookup).
  Without SEMANTIC_SCHOLAR_API_KEY, S2's unauthenticated rate limit is easy to hit under
  moderate load (observed repeatedly in development) — a 429/timeout there degrades to the
  graceful "not enough information" response, not a fabricated explanation, but also not a
  successful one. Setting `SEMANTIC_SCHOLAR_API_KEY` raises this ceiling.
- **LLM completion timeouts needed to be longer than the 6s default** tuned for metadata-fetch
  API calls (search providers, citation lookups) — discovered live against the free-tier
  OpenRouter backend, where a real completion (a full prompt, not a trivial test) took long
  enough under normal (non-degraded) conditions to exceed 6s and fail after retries. Both LLM
  backends' non-streaming `complete()` now use a 30s timeout (matching what streaming already
  used) — noted here since it's a real, observed characteristic of LLM latency versus typical
  API latency, not a one-off fluke.
- **OpenRouter's free-model roster changes over time**, and free-tier capacity/latency is more
  variable than a paid API — the defaults chosen (`google/gemma-4-26b-a4b-it:free`,
  `nvidia/nemotron-3-ultra-550b-a55b:free`) were live-verified to work well at build time, but
  are overridable via `OPENROUTER_MODEL_CHEAP`/`OPENROUTER_MODEL_CAPABLE` if they're
  discontinued or degrade later. Some free reasoning-tuned models were tested and rejected as
  defaults during development because they burned their entire token budget on hidden
  reasoning with no visible output for simple prompts.
- **Conversational search's mode/query rewriting is only as good as the underlying LLM call**,
  and degrades to literal keyword search (never a broken search experience) on any failure —
  but that means its clarifying-question behavior is unavailable in the same conditions
  summaries/chat are unavailable (no configured LLM provider).
- **No browser-based end-to-end test coverage for the graph view, edge-click reasoning, or
  the conversational search-bar clarify loop**, for the same reason as every other frontend
  feature in this project — verified via live API checks and manual curl/SSR inspection.

## Visual redesign (sub-project #1)

- **Placeholders are inert, not hidden.** `Library` in the navbar and the homepage's `Draft`,
  `Diagrams`, `Presentation` and `Tools ▾` affordances are visible but non-interactive, each
  tagged "Soon". They are deliberate signposts for sub-projects #2–#9, not dead links — but
  they are also not functionality, and a first-time visitor will find more buttons than
  behaviors.
- **No in-app theme toggle.** The palette follows the OS `prefers-color-scheme` setting only.
  A manual override needs somewhere to persist the choice, which is the accounts/preferences
  sub-project (#5).
- **Verification is screenshot-driven, not automated.** The redesign was checked by driving a
  production build with Playwright (home, results, `/health`, chat open, summary error state,
  both themes, mobile) and reading the screenshots. There are still no end-to-end tests
  asserting any of it, so a future restyle can regress layout without failing CI (see
  `ROADMAP.md`).
- **The provenance spine only counts search-time sources.** It lights a tick per source that
  returned the record in _this_ search, so a provider that was rate-limited or down that
  minute reads the same as one that genuinely has no record of the paper. The degraded banner
  above the results is what disambiguates them.

## Document ingestion (sub-project #2)

- **Uploads are the one feature that genuinely requires Postgres.** Every other
  database-backed path in this app is an accelerator that degrades to "no cache" when the
  database is unreachable. An upload has nowhere else to put its chunks, so
  `POST /api/documents` returns a 503 instead of pretending to succeed. This is a real
  exception to the app's degradation contract and is called out here rather than buried in a
  code comment.
- **No OCR.** A scanned, image-only PDF has no text layer to extract and is rejected with a
  422 saying so. Adding OCR is a separate decision with its own dependency and cost profile.
- **PDF only, one file per request.** No DOCX, no LaTeX source, no HTML, no multi-file upload.
- **No virus scanning.** Out of scope for a self-hosted research tool. Uploaded bytes are
  stored as received and streamed back only to the session that uploaded them.
- **Documents are page-capped at 500 pages.** A longer PDF ingests its first 500 pages and
  reports `truncated: true`. Nothing warns a reader mid-document that the tail is missing
  beyond that flag.
- **Ownership is a signed cookie, so it is per-browser, not per-person.** Anyone with the
  browser session has the documents; the same person on a second device has none. Accounts
  (#5) adopt these rows rather than orphaning them, but until then, clearing cookies is
  indistinguishable from losing the uploads.
- **An unset `SESSION_SECRET` silently costs you every upload on restart.** The app mints an
  ephemeral per-process secret and logs a warning rather than refusing to start, so uploads
  work in development without configuration — but every existing cookie stops verifying when
  the process restarts, and those documents become permanently unreachable (the rows and
  blobs remain, owned by a session id nobody can present).
- **No retention policy or garbage collection.** Documents live until explicitly deleted.
  Deleting removes the rows and the blob; a blob whose deletion fails after its rows are gone
  is logged and leaks disk.
- **`retrieveChunks` is deliberately not an HTTP endpoint.** Exposing raw retrieval would let
  anyone holding a document id page through an entire copyrighted PDF a chunk at a time.
  Retrieval is reachable only through features that consume it.
- **Chunking is layout-blind.** Text is normalized and split on paragraph/sentence boundaries
  with no awareness of columns, tables, figure captions, or footnotes, so a two-column paper
  can interleave text across the column gutter. Geometric table handling is #7's problem.
- **Migrations drifted before this sub-project and were not repaired by it.** The migration
  snapshot still declares ten tables `schema.ts` no longer has (`author`, `venue`,
  `credit_transactions`, `llm_usage`, and others — leftover early scaffolding). Because of
  that drift `drizzle-kit generate` prompts to disambiguate renames and cannot run
  non-interactively, so migration `0011` was hand-written. Repairing the snapshot is a
  separate task, deliberately not bundled here: the generated repair would emit ten
  `DROP TABLE` statements.

- **`/reader/[documentId]` renders its 404 page under a `200` status.** Next streams the
  response body, so the headers are already sent by the time `notFound()` runs (documented in
  `next/dist/docs/01-app/03-api-reference/03-file-conventions/loading.md`). The correct 404 UI
  renders, with `<meta name="robots" content="noindex">`. This is cosmetic, not a hole in the
  capability model: the status is 200 for a nonexistent id and for someone else's id alike, so
  nothing is distinguishable, and every `/api/documents/*` route — the layer that actually
  hands out data — returns a real 404. Fixing it properly means a proxy-level existence check
  before streaming, which would put a session-cookie DB lookup on the hot path of every
  request.
- **The reader has no automated coverage.** The split view, the scroll-to-page wiring and the
  upload drop zone are the most valuable parts of sub-project #3 and none of them are tested:
  this repo has no jsdom, no `@testing-library/react`, and no Playwright in `devDependencies`.
  Verification was browser-driven by hand, which is how the `SESSION_SECRET` module-graph bug
  was found — a bug no unit test in this suite could have caught. That is the argument for
  Playwright, and it should be weighed before #4 rather than after #9.

- **A small `maxTokens` can come back empty from a reasoning model.** Several backends default
  to one — Groq, the default free-tier provider, serves `openai/gpt-oss-20b` — and on those the
  reasoning trace is billed against `max_tokens` before any content is emitted. A tight budget
  therefore yields a successful call with an empty string. This was observed live in topic
  labelling at 900 tokens and is now handled there, but `summary` (300), `citations/reasoning`
  (250) and `queryUnderstanding` (200) all pass smaller budgets and carry the same risk. All
  three already degrade gracefully on an unusable response, so the symptom is a quietly missing
  feature rather than an error — which is exactly what makes it hard to notice. The provider
  layer now logs `llm_empty_completion` with the model and finish reason whenever it happens,
  so it is at least visible. Raising those three budgets is a separate change, because each
  needs its own live check that output quality does not drift.
- **Only OpenAlex supplies topic data.** "Find topics" aggregates concepts the sources return,
  and OpenAlex is the only one that returns any. A result set OpenAlex did not contribute to
  shows an honest empty state rather than a model-invented topic list.
- **Topic filtering is client-side only.** `SearchFilters.topics` narrows the loaded result
  set; the search API exposes no topic parameter, so it cannot narrow the fan-out itself. The
  filter therefore lives in `components/search/filters.ts` rather than the shared
  `lib/merge/filter.ts` — there is no server-side definition for it to drift from yet.

## Accounts and the library (sub-project #5)

- **Accounts are off unless `BETTER_AUTH_SECRET` is set.** `/login` and `/signup` answer 503,
  no auth UI renders, and the library shows only this browser's uploads. That is deliberate —
  a self-hosted single-user instance should not have to configure identity — but it means a
  half-configured instance looks like a broken one unless you read the message.
- **Adoption is per-browser and one-way.** Anonymous uploads move to the account you sign into
  from that browser, and only while they have no owner. Uploads made in a different browser,
  or after someone else has already claimed that session, stay where they are. There is no way
  to merge two accounts, and no way to un-adopt.
- **Sign-out rotates the anonymous cookie, so anything uploaded while signed out is
  unreachable afterwards** unless it was adopted. This is the safe direction of the trade — the
  alternative hands the next person on a shared browser the previous user's documents — but it
  does mean an anonymous upload made between two sessions is effectively discarded.
- **No email verification and no password reset without SMTP.** With no `SMTP_URL`, sign-up
  succeeds unverified and password reset says it is unavailable rather than sending mail into a
  void. Requiring verification with nowhere to send it would lock every new account out.
- **A forgotten password on an instance with no mailer cannot be recovered** from the UI. The
  operator has to intervene in the database.
- **Rate limiting is in-memory and per-process.** Two instances behind a load balancer each
  hold their own counters, so the effective limit is per instance rather than per cluster.
  There is deliberately no environment switch to disable it.
- **Trusted origins are static.** better-auth resolves them once at context creation, without a
  request, so a new origin needs `BETTER_AUTH_TRUSTED_ORIGINS` and a restart. Loopback is
  wildcarded outside production only.
- **A saved paper is a snapshot, and it never updates.** If a provider later corrects the
  metadata, the library keeps what you saved. Silently rewriting saved records would be worse,
  but it means a stale citation can persist indefinitely.
- **Collections are private, with no sharing and no public links.** Export is per-collection
  and download-only.
- **Saved state on the results page is computed at render.** Save something in one tab and a
  results page already open in another still shows it unsaved until that page reloads.
- **The library is unpaginated.** Every saved item and collection is fetched and rendered on
  each visit, which is fine at hundreds of items and will not be at tens of thousands.

## Credits and sponsorship (sub-project #6)

- **No failover when the selected capacity source is broken.** Selection prefers sponsor
  capacity, and a sponsor whose key has a zero quota becomes the default for every request —
  each one fails at the provider rather than falling through to the next source. Provider
  choice is still made once per request, as it has been since Milestone 3. A misconfigured
  sponsor row is currently an outage, and `pnpm capacity --disable` is the fix.
- **Fail open means an outage is free.** With Postgres unreachable, AI features run unmetered
  and the pool is not billed. That is the chosen trade — a commons that stops serving because
  its bookkeeping is offline is worse — but it does mean a long database outage burns real
  provider quota that nothing accounts for.
- **A streaming backend that reports no usage is never charged.** Usage is requested via
  `stream_options: { include_usage: true }`, which any OpenAI-compatible backend may ignore.
  Rather than charge an estimate, nothing is debited. Undercharging is the deliberate direction.
- **Rate limits are per process, and so is nothing else here.** Two app instances share one
  database, so ledger and pool accounting are correct across them; only better-auth's in-memory
  rate limiting is per instance.
- **Anonymous allowance is per browser, not per person.** Clearing cookies grants a fresh one.
  It is deliberately small for that reason, and it never touches sponsor capacity.
- **The monthly period is a calendar month in the database's timezone**, not a rolling 30 days
  and not per-user. Someone who signs up on the 30th gets a top-up two days later.
- **Replenishment and the welcome grant only run at sign-in.** An account that never signs in
  again is never topped up, which is intended; but a user who stays signed in for six weeks sees
  their top-up land only when their session next re-authenticates.
- **Contribution grants read one page of OpenAlex results** (200 works). Beyond that the
  diminishing-returns curve has flattened the value of the tail anyway, but a very prolific
  author's oldest work is not counted.
- **Publication credit assumes OpenAlex's author-ORCID index is right.** A work wrongly attributed
  there grants credits here; a work missing from it does not. There is no manual claim path.
- **ORCID peer reviews are only visible if the researcher made them public.** A private review
  section reads as no reviews, which is indistinguishable here from having none.
- **Estimates are static per feature, not per input.** A 40-page document chat and a two-line
  one pre-flight against the same figure. The actual debit uses real tokens, so the estimate
  only affects who is refused, never who is charged what.
- **There is no refund path in the UI.** The `refund` reason exists in the ledger and is only
  reachable by an operator writing a row.
- **Two dead tables predate this work.** `credit_transactions` (migration `0010`) and
  `llm_usage` (`0009`) are from an early scaffold, are in no schema file, and nothing reads or
  writes them. `credit_ledger` is the real ledger. They are left in place rather than dropped
  because dropping tables is not something to do quietly.

## Extracted data and evidence matrices (sub-project #7)

- **Findings extraction is unreliable on a reasoning-model free tier.** Groq's default
  `openai/gpt-oss-20b` bills its internal trace against `max_tokens` before emitting content, and
  on this task it sometimes spends the whole budget and returns nothing. Mitigated — three
  retrieval queries instead of five, three excerpts instead of eight, an explicit "do not explain
  your reasoning" instruction, and a 4000-token budget — but not eliminated. Table extraction is
  geometric and unaffected. Re-running usually works.
- **Findings can also stop early on a rate limit.** Sequential calls with multi-thousand-token
  excerpts hit Groq's per-minute token limit; the run stops at the first 429 rather than
  collecting two more, so a document may come back with only the first group of fields.
- **No OCR**, inherited from #2. An image-only table has no text layer and is invisible here.
- **No spanning cells, rotated tables, or ruled-line parsing.** Column boundaries are inferred
  from text positions alone. A table split across a page break comes out as two tables.
- **A wide, sparse table can fall below the confidence floor and not surface at all.** The
  brevity factor that rejects two-column prose also penalises tables whose cells are long
  descriptive text.
- **Confidence is a geometric score, not a correctness probability.** A table with clean columns
  and a misread number scores 1.0. It measures how table-shaped the region was, nothing more.
- **No figure, chart, or image extraction, and no chart digitization.**
- **No cross-document row deduplication.** The same paper uploaded twice is two rows.
- **No pooled statistics and no meta-analytic computation, ever.** Extraction is not synthesis;
  crossing that line silently would be a research-integrity problem rather than a feature.
- **An uploaded PDF is not linked to a canonical work**, so a matrix has no citation column.
  Title-matching against the corpus is within reach but belongs to #8, where the writer actually
  needs the link — half-building it here would produce confident wrong attributions.
- **A matrix fill is one long request.** There is no progress indicator beyond the button state
  and no way to cancel a run part-way; a large matrix can run for minutes.
- **Re-extraction replaces.** There is no history of what a previous run produced, so a model
  change is invisible after the fact.
- **A pre-existing Turbopack build warning** — "the whole project was traced unintentionally" —
  is emitted for every route reaching the blob store, because `localDisk.ts` resolves its upload
  directory at runtime. It bloats that route's traced bundle and does not affect behaviour;
  `turbopackIgnore` comments did not silence it.

## The AI writer (sub-project #8)

- **No `.docx` export.** It is what most researchers actually submit, so this is deferred rather
  than refused: it needs a new dependency and its own fidelity work, and the Markdown and LaTeX
  paths cover the communities most sensitive to citation correctness. It is the obvious next
  addition.
- **LaTeX exports one file containing two.** The `.bib` follows the `.tex` behind a comment
  banner, because adding a zip dependency for a single format was not worth it. The reader has to
  split it.
- **No real-time collaboration, no comments, no track-changes.** y.js plus a websocket server is
  a second runtime for one feature.
- **The inline label is computed twice** — once on the server for the bibliography and once in
  the editor to paint the chips. They are kept in one small function each, but they are two
  implementations of one rule and could drift.
- **A citation can only point at a saved paper.** Citing an uploaded PDF, which #7 deferred to
  here, is not implemented: an upload has no DOI and no bibliographic record, and the
  corpus-matching path that would give it one is still unbuilt. An upload therefore cannot be
  cited at all rather than being cited wrongly.
- **Autosave has no conflict detection.** The same manuscript open in two tabs is last-write-wins,
  and the loser's changes are only recoverable from the revision ring.
- **Revisions are not exposed in the UI.** They are written and capped, and reading one back
  currently means a database query. The safety net exists; the ladder out of the well does not.
- **The grounded draft is one call with no streaming.** A long draft looks like a hang for up to
  a minute, and it cannot be cancelled.
- **Sentence splitting for the draft guard is punctuation-based.** An abbreviation like "et al."
  can split a sentence in two; the cost is an over-split sentence, never a wrong citation.
- **Rewrite and tighten reuse #4's paraphrase endpoint**, which returns plain text — so applying
  one to a selection containing a citation node drops that node. The panel does not stop you.
- **No journal templates and no style-sheet compliance checking.** Three prose styles, formatted
  from CSL-JSON, and nothing that claims to satisfy a specific journal's house rules.

## The citation-graph explorer (sub-project #9)

- **Citation coverage is incomplete and biased, and every metric says so.** OpenAlex, Crossref
  and Semantic Scholar all have gaps; preprints, books and non-English work are systematically
  under-linked. Clusters, in-degree and paths describe the loaded subgraph and nothing else.
- **A twenty-result seed fills the 150-node budget immediately.** References are taken round-robin
  so every root is represented, but the graph is then a sample of each paper's citations rather
  than all of them. Filters and collapse are the way to see structure.
- **The budget is a hard cap, not paging.** There is no server-side graph computation and no way
  to explore beyond 150 nodes at once.
- **Node identity resolves by DOI or not at all.** The spec's second tier — matching a DOI-less
  reference against the `work` table by title and year — is not implemented: those refs get a
  stable `unresolved:` id, render dimmed and cannot be expanded. Guessing an identity from a
  title match is how a graph starts asserting edges between papers that are not the same paper.
- **The explorer fetches every seed's citations from the browser** and hands the renderer one
  graph when they have all settled. Twenty seeds is twenty requests, and the page shows progress
  rather than partial graphs — feeding a growing graph to a renderer that owns expansion state
  would discard the user's exploration on every update.
- **Force layout only.** The year-layered layout is computed (`yearLayers`) and not yet wired to
  the canvas, so lineage is legible in the analysis but not in the picture.
- **Shortest citation path is computed but has no UI.** Selecting two nodes to see the lineage
  between them is the obvious next addition.
- **No saved or shareable graph views.** A URL carries the seed, never the exploration done from
  it.
- **No co-authorship, venue, or concept graphs.** A different product.
- **No cluster narration, ever.** A generated paragraph explaining what a cluster "represents"
  launders incomplete data into confident prose. Edge-level citation reasoning stays because it
  is grounded in two specific named papers.

## The presentation builder

- **A deck is not saved.** It is generated, shown, and exported; a refresh loses it. Persisting
  one means a table, a migration and an ownership surface, and the Markdown export is the
  artifact people actually want to keep.
- **Markdown only — no `.pptx`.** Marp renders these slides in VS Code and converts to PDF or
  PPTX from the command line. Writing a binary deck from here would mean a dependency emitting
  an opaque zip this project could never test the contents of.
- **The deck is built from one search, not from your library.** Seeding it from saved papers or
  a collection is the obvious next addition and is not implemented.
- **No speaker notes, no images, no figure reuse.** Slides are titles and cited bullets.
- **The guard can empty a deck.** If every bullet comes back uncited the page shows nothing and
  says why, which is the intended outcome and still a failed generation from the user's side.
  Narrower topics attribute better than broad ones.
- **Abstracts only.** Bullets are grounded in the abstracts of the papers a search returned, so
  a claim buried in a paper's results section cannot appear. This is the same ceiling every
  non-`/reader` feature has.

## Table extraction, after the superscript fix

- **A spanning row still breaks a table.** A full-width group header or a "continued" row has
  no column gap, so `findRegions` ends the run there and the fragments on either side are
  usually too short to detect. Telling a spanning header apart from a line of prose between two
  tables needs row-pitch analysis, which is a separate change — the guard for it was written,
  found unreachable, and removed rather than left in as decoration.
- **Two columns closer together than ~2.2 character widths merge into one.** That threshold is
  what makes a gutter a gutter; a very tight table pays for it.
- **Rotated, multi-page and cell-spanning tables are out of scope.** The detector reads one
  page of horizontal text.

## Credits and sponsorship (sub-project #6)

- **`pnpm db:generate` cannot run non-interactively.** The drizzle meta snapshot has drifted from
  `schema.ts` — it still contains tables (`author`, `venue`, `credit_transactions`) that the
  schema no longer declares — so the generator opens a "created or renamed?" prompt for every one
  of them. Migrations in this repo are hand-written anyway, which is why this has gone unnoticed;
  reconciling the snapshot means answering that prompt chain correctly once, and answering it
  wrong would emit a `DROP TABLE`. Left alone deliberately.
- **A dormant source is retried on a fixed clock, not on a signal.** Five minutes for a 429 and
  six hours for a 401/402/403 are guesses at what those statuses usually mean. A provider that
  publishes a `Retry-After` header is not consulted, and a key topped up two minutes after being
  refused waits out the full six hours unless an operator runs `pnpm capacity --revive`.
- **Endpoint sources are not health-checked before use.** A relay that has been switched off is
  discovered by the first request that fails over past it, which costs that request a round trip.
  The spec's `healthcheck_endpoint` is not polled; the circuit breaker in `withResilience` covers
  the repeat case, not the first one.
- **A donated node serves one model for both tiers.** There is no cheap tier on a cluster running
  a single 70B model, so a bulk job (summaries, topic labels) routed there costs the sponsor the
  same as a synthesis. Ranking endpoints below the named providers limits the exposure but does
  not remove it.

## Test suite

- **A large part of the suite asserts "no database configured" behaviour, and stops asserting it
  when a database exists.** The db client is memoized at import, so a test cannot take the
  database away from itself — `delete process.env.DATABASE_URL` inside a test has no effect once
  anything has resolved a client. Five tests (four in `api/search/route.test.ts`, one in
  `ai/citations/reasoning.test.ts`) pass for the wrong reason when `DATABASE_URL` is set, which
  is why CI runs the main suite without one and gives a database only to the `*.integration.test.ts`
  files. Making them database-agnostic means mocking `lib/db/client` per file; worth doing, not
  yet done.
- **Recorded provider fixtures are all well-formed.** They test each parser but never its
  assumptions — a real arXiv record with a repeated `<arxiv:doi>` element once took down an
  entire search, and no fixture would have caught it.
