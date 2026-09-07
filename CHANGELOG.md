# Changelog

All notable changes to Scholastic are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Sponsored endpoints: relays and donated cluster hours.** A sponsor whose grant terms forbid
  handing over an API key can now donate the quota behind it anyway, by exposing a scoped
  OpenAI-compatible URL they keep custody of (`--provider outpost`); a university cluster can
  donate the hours it is otherwise idle (`--provider node --hours 18:00-06:00 --days 1,2,3,4,5`).
  Neither adds a secret to the database: `base_url` is a URL, and a relay's bearer token is held
  the only way this project holds a credential — in the environment, named by `credential_ref`.
  A node on a private network may have no credential at all, which is the sole case where
  `credential_ref` is null.
- **The capacity pool now fails over instead of failing.** `selectCapacity` returns a dispatcher
  over the whole ranked pool rather than a single provider. A source that answers 401, 402, 403
  or 429 is tripped dormant — five minutes for a rate limit, six hours for a key being refused —
  and the request moves to the next source. A 400 is not retried anywhere: it will fail
  identically on every backend, and replaying it would spend another sponsor's quota to learn
  nothing. Tokens are billed to whichever source actually answered, not the one first chosen.
- **A stream never fails over once it has delivered a token.** Restarting on another backend
  would splice two different answers together mid-sentence.
- **Sponsor attribution (`X-Capacity-Sponsor`, and a line under a generated deck).** Opt-in
  twice over: the source must be marked public _and_ carry a sponsor name. It names the donor,
  never the researcher.
- **`pnpm capacity --revive <id>`**, and `--list` now prints the dormancy clock, the endpoint and
  its schedule — "dormant" alone does not tell an operator whether to go and look at the key.
- **Matrix export as Markdown** (`?format=md`, "Export Markdown" beside the CSV button). The
  same table for pasting into a draft, with the page beside each value and the quotes carried
  underneath rather than dropped to make it fit. A paper that does not report a field reads
  _not reported_, distinct from a cell nothing was extracted into.
- **Presentation builder (`/present`, `POST /api/deck`).** Searches the literature on a topic
  and outlines a slide deck from what those papers say, one claim per bullet, each carrying its
  source. `lib/deck/outline.ts` is the guard: a bullet with no citation the caller supplied is
  deleted, a slide whose bullets all went that way is deleted, and an emptied deck says so
  rather than showing uncited claims. Exports Marp-compatible Markdown — `---` slide breaks,
  inline labels through #4's formatters, and a numbered reference slide in first-appearance
  order, so the numbers on a bullet and the numbers in the references cannot disagree.
- **The model is never shown a workKey.** Sources are tagged `S1..Sn` and `remapCitations`
  rewrites the tags afterwards. The first live run asked for exact keys like
  `doi:10.1038/nbt.3117` and lost all five slides to the guard: 15 citations came back one
  character wrong, which is indistinguishable from an invented one.
- **The three "Soon" chips on the homepage now do something.** _Draft_ creates a manuscript
  titled from the query and opens the #8 editor (sending an anonymous visitor to sign in
  first); _Citation map_ — renamed from _Diagrams_ — seeds #9's multi-root explorer from the
  query's results; _Presentation_ opens the deck builder.
- `deck_outline` in the credit cost table (16 credits, the most expensive single action), shown
  on the button before it is pressed. A deck is never generated on page load.

### Fixed

- **A repeated XML element from arXiv took down the entire nine-provider search.** One result
  for "sleep deprivation" carries four identical `<arxiv:doi>` elements; the parser collapses
  repeats into an array, so `doi` reached `normalizeDoi` as `string[]` and threw
  `doi.trim is not a function` from inside `clusterWorks` — after six providers had already
  succeeded. Fixed in the mapper (`firstString` for doi, title and summary, which can all
  repeat) with a `typeof` guard in `normalizeDoi` behind it, so one malformed record costs that
  record rather than the merged search.
- **Superscripts split a table into a phantom extra column.** `O((log p)^3)` reaches pdfjs as
  five items, and clustering their start-x — which discards width, the one thing separating a
  gutter from a space — invented a boundary inside the cell, so every data row had one more
  cell than its header and every value after the formula shifted right. Columns are now the
  occupied bands of the x axis (`columnBands`), found by projecting each item's full span.
  Alignment stops mattering, so the left/right-aligned tie-breaker is gone.
- **`/graph` from the navbar was a dead end** — an explainer with nothing to click. It now
  carries its own seed form, and seeds from a signed-in user's library when they have one.

### Removed

- `clusterPositions` and the left/right-alignment tie-breaker in `lib/pdf/tables.ts`, dead once
  columns became bands. Deleted rather than kept for a use that no longer exists.
- The `Tools ▾` pill and the matrix grid's `title` prop: a control that did nothing, and a page
  title printed a second time in its own help text.

### Added

- **Design specs for sub-projects #2–#9** in `docs/superpowers/specs/`: document ingestion,
  chat with PDF, quick-win tools, accounts and library, credits and sponsorship, extract
  data, the AI writer, and the citation-graph explorer.
- **Sub-project #2 — document ingestion.** Upload a PDF, store it, extract its text, chunk it
  page-aware, embed the chunks into pgvector, and retrieve them. Deliberately not
  user-facing: #3 builds the first UI on top of it.
  - `BlobStore` interface with a local-disk implementation (`lib/storage/`), selected through
    `getBlobStore()` so a hosted store can be added without any caller changing. Blob keys are
    validated against an allowlist shape rather than sanitised, so a key can never escape the
    upload directory.
  - `lib/pdf/extract.ts` wraps `unpdf` (the only module that touches a PDF library) and
    `lib/pdf/chunk.ts` does page-aware chunking with overlap — pure, so every chunking rule is
    unit-tested.
  - `lib/documents/` — signed anonymous session cookie, repository, two-phase ingestion, and
    `retrieveChunks()`, the single contract #3 and #7 consume.
  - `document` and `document_chunk` tables (migration `0011`), the latter with an HNSW index
    and a per-model embedding id, so a model change is a cache miss rather than a silent
    comparison across vector spaces.
  - `POST`/`GET /api/documents`, `GET`/`DELETE /api/documents/[documentId]`, and
    `GET /api/documents/[documentId]/file`. A document owned by another session answers 404,
    never 403 — a 403 would confirm an unguessable id is real.
  - 67 new tests (347 total, all passing), including an integration test against a committed
    PDF fixture that exercises the real `unpdf` path.
- **Sub-project #3 — chat with PDF.** `/reader` to upload a paper, `/reader/[documentId]` for a
  split view with the rendered PDF beside a chat grounded in its full text. The first
  user-facing surface #2's upload endpoint has ever had, and the first chat in this app that
  reasons over something other than an abstract.
  - `/api/chat` gains an optional `documentId`, mutually exclusive with `context` and `works`.
    Supplying more than one is now a 400 naming the conflict; previously `works` won over
    `context` implicitly by ordering.
  - A fourth system prompt, which requires page citations and — because retrieval returns
    excerpts, not the paper — forces the model to distinguish "the excerpts don't cover this"
    from "the paper doesn't say this". Only the first is defensible.
  - Retrieval ranks against the **latest** user message, deliberately unlike the synthesis
    branch's `messages[0]`: "what dataset?" and "what do the limitations concede?" are
    questions about different pages of one paper.
  - `lib/documents/chatContext.ts` and `lib/documents/pageCitations.ts` — both pure, so the
    page-attribution format and `[p. N]` parsing are properly unit-tested.
  - `ChatPanel` gains `documentId`, `onCitePage`, `variant`, `composerDisabledReason` and
    `notice`. Every existing call site is unchanged: `variant` defaults to `"disclosure"`.
    Clicking a `[p. 7]` chip scrolls the PDF pane to that page.
  - `PdfPane` renders through `react-pdf`, keeping a live canvas only within two pages of the
    viewport — #2 allows 500-page uploads, and 500 canvases is an out-of-memory tab. The pdf.js
    worker is copied into `public/` at postinstall rather than loaded from a CDN, so the reader
    works offline and adds no third-party origin to a page showing user documents.
  - The reader polls until the document reports `indexed` and keeps the composer disabled until
    then, so first-turn embedding cost is visible rather than looking like a hang.
  - `Reader` is now a real nav link. `Library` stays "Soon" until #5.
- **Sub-project #4 — quick-win tools.** Three independent tools: a citation generator, topic
  discovery over a result set, and a clarity rewriter.
  - **Cite.** `lib/citations/` maps `CanonicalWork` → CSL-JSON and formats APA, MLA, Chicago,
    BibTeX and RIS. Deterministic end to end — no LLM anywhere, because a citation that is
    _plausibly_ wrong is worse than one that visibly admits a gap. A `Cite` popover on every
    result card renders all five styles with a copy button.
  - Where a style needs a field the data doesn't have, the citation renders anyway **with an
    explicit note naming what's missing** rather than a malformed string that reads as
    finished. Preprints are exempt from volume/issue/page, which they don't have.
  - `RawWork` gains optional `bibliographic` (volume, issue, pages, publisher, container,
    type, issued date, ISSN/ISBN), populated by the Crossref, OpenAlex, PubMed and Europe PMC
    mappers. arXiv, DOAJ, CORE, Unpaywall and Semantic Scholar are untouched.
  - `pickBibliographic` selects that block **whole**, from the single highest-priority source
    that has one — unlike every other picker in `reconcile.ts`, which merges field by field. A
    citation assembled from three sources' fields looks authoritative and can be wrong in a way
    no reader could detect.
  - **Find topics.** `lib/topics/aggregate.ts` frequency-ranks the concepts OpenAlex already
    returns (deterministic, free, no model); one LLM call then clusters and labels them. Every
    concept the model returns is checked against the input and dropped if it wasn't there —
    an invented concept would filter to nothing and read as a bug in search. With no LLM, the
    ranked concepts render unlabelled. Clicking a theme narrows the result list in place.
  - **Rewrite.** `POST /api/paraphrase` streams a clarity rewrite of text the user pastes in,
    as a third tab in the reader. Three prompt constraints are treated as correctness, not
    style: citation markers survive verbatim, no claims are added, and hedging is preserved —
    "may suggest" must not become "shows". Capped at 2000 words. Explicitly **not** an
    authorship-obscuring or detection-evasion tool, the same refusal `ROADMAP.md` already makes
    about the AI detector, from the other side.

- **Sub-project #5 — accounts and the library.** Optional email/password and OAuth accounts, a
  library of saved papers, uploads and collections, and adoption of anonymous uploads on
  sign-up. The persistence and identity layer #6 and #8 build on.
  - Accounts are **off** unless `BETTER_AUTH_SECRET` is set: `/login` and `/signup` answer 503,
    no auth UI renders, and the app behaves exactly as it did before #5. Checked rather than
    defaulted — a generated fallback secret would invalidate every session on restart.
  - One `Owner` type resolves both kinds of owner (`{ kind: "user" }` / `{ kind: "anonymous" }`)
    for documents, saved items and collections, so #2's rule survives intact: ownership stays in
    the `WHERE` clause and someone else's row answers **404, never 403**.
  - **Anonymous uploads are adopted on sign-up and sign-in**, filtered on
    `ownerSessionId = :sid AND user_id IS NULL`. That `IS NULL` is the entire security of the
    operation: without it, a second person signing in on a shared browser inherits the first
    person's documents. Sign-out rotates `scholastic_sid` for the same reason. All four cases
    are covered end to end, because none of them exist below the HTTP layer.
  - `saved_item` holds saved search results and uploaded documents in one table, discriminated
    by `item_type` and constrained by a `saved_item_shape` CHECK. A saved paper keeps a
    **snapshot** of the merged `CanonicalWork`: providers revise their metadata, and a library
    that silently rewrites what you saved is not a library.
  - `Save` sits beside `Cite` on every result card and renders for everyone — a control that
    appears only once you have an account cannot tell you the account exists. Clicking it signed
    out explains what to do instead of failing.
  - `/library` (papers, documents, collections), `/library/collections/[publicId]` with
    drag-free reordering and per-collection export, `/login`, `/signup`, and an account menu in
    the nav. `/library` is reachable signed out and shows this browser's uploads.
  - Five `/api/library/*` routes behind `requireUserApi()`, which answers JSON 401 while pages
    redirect to `/login?next=…` — a fetch that follows a redirect to an HTML login page reports
    a confusing success.
  - **Playwright arrives here**, ahead of its place in the roadmap, because #5 is the first
    sub-project whose correctness lives in things no unit test can see: cookies crossing a
    redirect, adoption reading a response the request cannot, one browser holding two
    identities. 12 end-to-end tests against a production build; it caught two real bugs on its
    first run (below).
  - 490 unit tests (up from 464), including 15 library integration tests against real Postgres
    and 9 covering owner resolution and adoption.

- **Sub-project #6 — credits and sponsorship.** A shared, donated pool of AI capacity,
  allocated by an append-only credit ledger. Credits are never purchasable, never transferable,
  and never earned by using the app.
  - **Capacity, credits and contribution are three separate concepts**, deliberately: real
    provider quota, a user's claim on it, and what mints a claim. Conflating them is the failure
    this design exists to avoid.
  - `capacity_source` records the **name of an environment variable**, never a key. Sponsorship
    is operator-mediated through `pnpm capacity`; a web form that accepts a pasted API key is an
    explicit non-goal, written down so it does not return as a convenience feature. Sponsor
    capacity is preferred over operator capacity, so donations are actually consumed.
  - `credit_ledger` is append-only and canonical, with `credit_balance` written in the same
    transaction and a `sum(delta) == balance` reconciliation. A bare counter can say _12_ but
    never _why 12_, and in a commons unexplainable accounting is a trust problem.
  - **Reserve, then reconcile.** Pre-flight blocks before anything is spent; the debit runs on
    the usage callback with real token counts and never breaks a delivered response. A failed,
    refused or interrupted call is never charged.
  - Search, dedupe/merge/rank, filtering, citations, the graph, PDF reading, saving and
    collections are **free forever**. Only model calls are metered, every metered control shows
    its estimated cost before it runs, and a refusal names what still works.
  - A refusal is **403, not 402**: Payment Required would tell a client to pay, and nothing here
    is purchasable.
  - ORCID OAuth (`/authenticate` scope) proves iD ownership; publications come from OpenAlex and
    reviews from ORCID's public API, so the token is discarded immediately. Publications past a
    threshold earn a halving rate — a prolific senior author should not corner a pool an
    early-career researcher needs.
  - Anonymous visitors get a flat per-browser allowance drawn **only from operator capacity**.
    Sponsors donate for researchers, not for an unauthenticated firehose.
  - `/credits` is private, `/sponsors` is public and carries no per-user data. **No leaderboard,
    badge, or public profile** — a public credit score is a reputation metric, and academia's
    existing ones have a documented history of being gamed.
  - 51 new tests (541 total) and a third end-to-end spec, including 13 ledger integration tests
    against real Postgres covering idempotency, clamping and reconciliation.

- **Sub-project #7 — extract data.** The numbers out of papers, with provenance. A **Data** tab
  in the reader for one PDF's tables and reported statistics, and `/matrix` — an evidence matrix
  whose rows are your uploads, columns are fields you type, and cells carry the page and the
  sentence they came from.
  - **Tables are geometry, findings are semantics, and they are extracted separately.**
    `lib/pdf/tables.ts` is pure and sees no model: lines by baseline, column boundaries by
    clustering start-x _and_ end-x (a right-aligned numeric column has no shared left edge), cells
    by nearest boundary. Flattening a page to text and asking a model for structure is exactly how
    a number lands in the wrong row.
  - Table extraction is **free** — deterministic, no provider call — so it works with no LLM
    configured and on an empty credit balance.
  - `confidence` is computed from occupancy, row consistency and **cell brevity**. The third
    factor exists for one failure: two-column prose is perfectly occupied and perfectly regular,
    so the other two score it 1.0 and it surfaces as a confident table.
  - **The non-invention guard**, mechanical and unit-tested. Interpretation may relabel and never
    re-value: a unit not present in the grid discards the entire interpretation and the raw grid
    stands unlabelled. Every finding must quote its source **and** the value must appear inside
    its own quote — a genuine quote cited for an inferred number reads as provenanced and is not.
  - **`not_reported` is a first-class status.** A blank cell means the paper does not report that
    field, never that the extractor gave up, and a database CHECK makes a `found` cell without a
    page and a quote unstorable. A cell that cannot quote its value degrades to "not reported"
    rather than being shown as a value.
  - One cell is one retrieval plus one scoped call, never one large call per paper: cells fill in
    parallel, a failure is one cell, and re-running a column costs one column.
  - A fill is priced before it runs (`GET` estimates, `POST` performs) — a 20×6 matrix is 120
    provider calls.
  - CSV export carries a page and a verbatim quote beside every value, writes "not reported" out
    in full, and neutralises formula injection so a negative effect size cannot execute in Excel.
  - Matrices are owned like documents and adopted on sign-in by the same `user_id IS NULL` UPDATE.
  - 60 new tests (600 total), including 8 matrix integration tests against real Postgres.

- **Sub-project #8 — the AI writer.** `/write` — a manuscript editor whose citations are live
  objects rather than typed text, with a derived bibliography, four exports, and one grounded
  drafting mode.
  - **A citation node stores exactly one attribute: the workKey.** No number, no author-year
    string, nothing about rendering. Reordering paragraphs renumbers, switching APA to MLA is a
    re-render rather than a rewrite, deleting a sentence removes its bibliography entry, and the
    same work cited twice produces one entry. This is the whole reason the editor is ProseMirror
    (Tiptap 3.31.3) rather than a markdown box.
  - The bibliography is **derived, never stored**, and formatted through #4's formatters — zero
    new formatting code, so a style switch here cannot disagree with a Cite popover there.
  - Works resolve from #5's `saved_item.workSnapshot` first and the `work` table second: a
    manuscript cannot tolerate a bibliography entry changing under it because a provider revised
    its metadata. An unresolvable key renders as a **visible broken-citation marker** inline and
    in the bibliography, never silently dropped.
  - **The AI never attaches a citation.** Find support ranks the library semantically, then live
    search, and requires an explicit pick — no confidence threshold inserts on its own. A wrong
    citation reads as authoritative and survives into the published version.
  - **One generative mode**, and it cannot produce an uncited sentence. The grounded draft writes
    from sources the user picked; `validateDraft` then strips any sentence with no citation and
    any citation outside that set, and if that empties the draft nothing is inserted and the user
    is told why.
  - Markdown, LaTeX, BibTeX and RIS export, all free and deterministic. LaTeX's `\cite{}` keys and
    its `.bib` keys come from the same function, so they cannot drift.
  - **The one feature that requires an account.** `manuscript.userId` is NOT NULL because a
    session-scoped manuscript is a data-loss trap dressed as convenience; `/write` explains that
    instead of redirecting. Autosave is debounced, with a capped revision ring behind it.
  - With no LLM configured the editor, citations, bibliography, style switching and every export
    still work. A usable citation-managing writer with zero AI is a design target, not an
    accident.
  - 48 new tests (640 total) and a fourth end-to-end spec.

- **Sub-project #9 — the citation-graph explorer.** The graph was a canvas inside one result
  card, seeded from one paper and expanded by right-clicking. It is now a first-class explorer at
  `/graph`, seeded from a paper, a collection, or a whole result set.
  - **The refactor is the feature.** All 317 lines of graph logic lived inside a React component
    where none of it could be tested. It now lives in `lib/graph/{model,identity,build,analysis,
filter}.ts` with 48 tests, and the component is a renderer over them.
  - The regression that motivated the old `graphData` memo is now guarded directly:
    `mergeGraph` returns the **same array references** when nothing changed, because
    `react-force-graph-2d` treats a new object as a changed graph and reheats the d3 simulation
    forever.
  - **Nodes carry the app's own `workKey`.** Most citation refs have a DOI, so the feared
    per-node lookup mostly does not exist; a DOI-less ref gets a stable `unresolved:` id and is
    dimmed and unexpandable, with the inspector saying why. That identity is what lets a node be
    marked as already in your library.
  - **Right-click is no longer the only way to expand.** Click selects and opens an inspector,
    double-click or Enter expands, arrow keys walk the edges, Escape deselects, and the doi.org
    jump became an explicit link — so a node can be looked at rather than navigated away from.
  - A `<canvas>` is invisible to a screen reader, so the same nodes and edges render as real DOM
    in a `<details>` disclosure with the same actions.
  - **The 150-node cap became a budget**: collapse a branch (removing only descendants reachable
    _exclusively_ through it), filter by year range, minimum in-degree within the set, or
    unresolved, with a continuous counter.
  - Multi-root seeding takes references **round-robin** across roots — draining the first seed
    would spend the whole budget on two papers and defeat the point, which is seeing that four of
    twenty results cite the same 1998 paper.
  - Deterministic analysis, free and unmetered: connected components, in-degree within the loaded
    set, shortest citation path, year layers. **Every metric is labelled "within the loaded
    subgraph"**, because citation coverage is incomplete and biased. LLM narration of clusters is
    refused for the same reason.
  - 48 new tests (688 total) and a fifth end-to-end spec.

### Changed

- `getLlmProviderForTask` is **gone**, not fixed. It ignored its `tier` argument and carried the
  repo's one standing eslint warning for four milestones; tier-aware selection now lives in
  `lib/capacity/sources.ts`, where a pool of sources can actually differentiate on it. Six call
  sites go through one seam, `lib/credits/metered.ts`.
- `streamComplete` reports token usage. It never did, so chat and rewrite — the two most
  expensive features — would have streamed for free. OpenAI-compatible backends are asked for
  `stream_options: { include_usage: true }`; Anthropic's counts are assembled from
  `message_start` and `message_delta`.
- Removed ~30 empty leftover scaffolding directories under `src/`.

### Fixed

- **A brand-new evidence matrix reported 2 papers and 2 fields.** drizzle qualifies column
  references with their table only when a query needs it, so a single-table select emits bare
  `"id"` and `"matrix_id"` — and inside a hand-written correlated subquery both resolved against
  the inner table, comparing `matrix_row.matrix_id` to `matrix_row.id`. The subquery never
  correlated and returned a plausible wrong number. Replaced with joins and `count(distinct ...)`;
  found by reading a live response, and now covered against real Postgres.
- **The search-results skeleton flashed on every page.** `app/loading.tsx` is the nearest loading
  state for all routes, so a search page materialised for half a second in front of the sign-in
  form, the library and the credits page. Moved into a `(search)` route group, which changes no
  URL.

- **Capacity usage was never recorded.** drizzle's `sql` fragments carry no column type, so a
  JS `Date` in an `UPDATE ... SET` reached postgres.js as an untyped parameter and threw
  `ERR_INVALID_ARG_TYPE`. Every token spent was billed to nobody. The month boundary is computed
  in SQL now, which also makes the rollover independent of the Node process's timezone. Found by
  reading the pool table after a live summary, not by a test — and only diagnosable after
  `describeDbError()` was added to unwrap drizzle's `cause` chain, the same blindness that hid
  the 23505 duplicate-collection bug in #5.
- **`verifySession` swallowed Next's static-rendering bailout.** `headers()` throws a
  `DynamicServerError` during prerender to signal "this route cannot be static", and the catch
  meant to treat a failed session lookup as "signed out" caught that too — logging a warning for
  every route at build time and telling the prerenderer the visitor was signed out.
  `unstable_rethrow` now re-throws Next's internal errors first.

- **A paper you had already saved rendered as unsaved on the results page.** `savedWorkKeys`
  existed and was tested but nothing called it, so `SaveButton` always started from
  `initiallySaved = false` and offered to save something already in the library. The results
  page now resolves saved state server-side in one query for the whole page. Found by the
  end-to-end test's unsave step, which is the only place the state survives a reload.
- **A collection you had just created appeared to vanish.** `router.refresh()` re-renders the
  page on the server and can take a second or more to land; until it did, the list showed the
  state from before the write. Creation now renders the collection the API returned and lets
  the refresh supersede it.
- **Auth rate limiting locked out ordinary browsing.** A flat 20/minute per address also
  applied to `get-session`, which the root layout calls on every page load — worse behind a
  NAT, where a whole office shares one address, and the end-to-end suite tripped it within one
  run. Split into a generous global limit for session reads and tight rules on the credential
  endpoints. An `AUTH_RATE_LIMIT=off` escape hatch was added and then removed: `next start`
  sets `NODE_ENV=production`, so the guard meant to keep it out of production was defeated by
  the very suite it was added for.
- **Every origin but one answered "Invalid origin".** better-auth 1.7 rejects any origin it was
  not told about, and it resolves that list once at context creation without a request — so a
  `trustedOrigins` function never sees one. Resolved from `BETTER_AUTH_URL` plus
  `BETTER_AUTH_TRUSTED_ORIGINS`, with loopback wildcarded outside production only.
- **Duplicate collection names returned 503 instead of 409.** drizzle wraps the driver error in
  `Error: Failed query: …`, which carries neither the SQLSTATE nor the constraint name, so a
  substring match on the message never fired. Detection now walks `err.cause` for SQLSTATE
  `23505`.
- **`ON CONFLICT` failed against a partial unique index** (Postgres 42P10). Postgres needs the
  index predicate restated in the conflict target, which drizzle spells `targetWhere`. Caught by
  the integration test on its first run against real Postgres.
- **Migration `0012` was silently skipped.** `0011`'s hand-written journal `when` had been
  rounded into the future, and drizzle only applies entries later than the last applied one, so
  the new tables were never created and nothing said so.
- **Sign-up returned 500 on a missing `account.issuer` column.** better-auth 1.7 writes a field
  the hand-written migration did not have; the canonical field list came from calling
  better-auth's own `getAuthTables({})`. Added in migration `0013`.
- **Topic labelling silently produced nothing on reasoning-model backends.** Groq — the
  default free-tier provider — serves `openai/gpt-oss-20b`, where the reasoning trace is
  charged against `max_tokens` _before_ any content is emitted. At a 900-token budget the same
  request returned valid JSON on one call and an empty string on the next, and the empty string
  was indistinguishable from a parse failure. The budget is now 2400, an empty completion is
  logged by name at the provider boundary (`llm_empty_completion`, with the finish reason), and
  `labelTopics` reports it separately from a parse failure. Found by browser-driving the
  feature, not by a test. The same latent risk applies to `summary` (300), `citations/reasoning`
  (250) and `queryUnderstanding` (200) — recorded in `KNOWN_LIMITATIONS.md`.
- **Chicago rendered two authors without the comma before "and".** "Lin, Michael T. and M.
  Flint Beal" reads as three names, because the comma inside the inverted first name becomes
  the list separator. Caught by reading real output from a live search, not from the fixtures.
- **An unset `SESSION_SECRET` made every uploaded document unreachable from the reader.** The
  ephemeral fallback secret lived in a module-level variable, and Next bundles Route Handlers
  and Server Components into separate module graphs — so it was minted twice, and a cookie
  signed by `POST /api/documents` failed to verify in the `/reader/[documentId]` Server
  Component, which answered 404 to the session that had just uploaded the file. The fallback
  now lives on `globalThis`, matching `lib/db/client.ts`. Found by browser-driving the real
  upload flow; no unit test could have seen it, and one now covers the module-graph case.
- `extractPdf` no longer consumes its caller's buffer. pdfjs takes ownership of the
  `ArrayBuffer` it is handed and detaches it, so reading `byteLength` after extraction
  returned 0 — which would have recorded `byteSize: 0` for every uploaded document. Found by
  testing against a real PDF rather than a mock; a regression test now asserts it.

## [0.4.0] — 2026-09-05

Sub-project #1 of the nine-part product sequence: the SciSpace-inspired visual redesign.
Presentation-layer only — no API route, data-flow, or provider logic changed, and the full
unit suite (278 tests) passes untouched.

### Added

- A dark-first token palette in `app/globals.css` (CSS custom properties surfaced as Tailwind
  utilities via `@theme inline`): `bg-page`, `bg-surface`, `bg-surface-2`, `border-line`,
  `text-ink`, `text-muted`, `text-accent`, `text-link`, and status tokens. Light mode is kept
  as the `prefers-color-scheme: light` palette under the same token names, so components no
  longer carry `dark:` variants for colors.
- `TopNav` — a persistent navbar on every page (root layout, inside a `<Suspense>` boundary
  because it reads the query string): wordmark, a compact search input that appears only once
  a query is active, `Search` / `Library` (inert, "Soon") / `Health` links, and an inert avatar
  placeholder. This also fixes a real gap: `/health` was previously unreachable from any nav.
- `HomeHero` — a chat/task-first homepage replacing the centered search hero: one large task
  box plus a quick-action row. `Search papers` and `Literature review` are functional; the
  latter runs the search with `?view=review`, which opens the multi-paper synthesis chat
  already expanded. `Draft` / `Diagrams` / `Presentation` and `Tools ▾` are inert placeholders
  for later sub-projects.
- A `hero` / `compact` variant split in `SearchBar` (one submit path, two presentations), and
  a `defaultOpen` prop on `ChatPanel`.
- A provenance spine on every `ResultCard`: nine ticks, one per aggregated source, lit for the
  sources that actually returned that record — cross-source agreement rendered as data rather
  than decoration. The wordmark reuses the same motif.

### Changed

- Every component restyled onto the tokens with a consistent radius/spacing scale:
  `ResultCard`, `ResultList`, `SearchExperience`, `FilterSidebar` (now a sticky card),
  `SummaryButton` (indigo-tinted AI-summary block), `ChatPanel`, `CitationsPanel`,
  `CitationGraphSection`, `CitationGraph` (including its canvas node/edge colors),
  `SimilarPapersPanel`, `SourceBadge`, `EmptyState`, `DegradedBanner`,
  `ProviderHealthDashboard`, `/health`, and `app/loading.tsx`.
- The results view now shows the active query as its heading; the navbar's compact input takes
  over as the search entry point there.
- The product is named **Scholastic** in the UI and docs (it was inconsistently "ScholarAI"
  while the repo, and now the wordmark, said Scholastic).
- Body type is Geist Sans — `globals.css` had been overriding it with Arial since the initial
  scaffold. Numeric metadata (years, citation counts, latencies) is set in Geist Mono with
  tabular figures.

### Fixed

- Long venue names in the filter sidebar overflowed into the results column — `<fieldset>`
  defaults to `min-inline-size: min-content`, which Tailwind's preflight doesn't reset, so the
  fieldset grew to its longest label regardless of the sidebar's width.
- Every open `ChatPanel` rendered a textarea with the same hard-coded `id="chat-input"`, so
  the ids were duplicated across cards; they now use `useId()`.
- **Submitting a search looked like nothing happened.** `runSearch()` cleared its pending
  flag in a `finally` immediately after calling `router.push()`, but the results page is a
  Server Component that fans out to nine providers, so App Router holds the navigation —
  URL included — until that render returns (10-25s on a cold cache). The button fell back to
  "Search" about a second in and the page then sat unchanged for the rest of the wait.
  `loading.tsx` doesn't cover this: its fallback is only shown for a prefetched route, and a
  programmatic `push()` never prefetches. Navigation now runs inside `useTransition()`, so
  `isNavigating` stays true for the full window and the button reads "Thinking…" while the
  query is being interpreted, then "Searching…" until results commit.
- **Searches got progressively slower — 3.6s, then 60s, 66s, 79s.** The durable search-cache
  read sat on the request's critical path with no time limit. When Postgres is unreachable
  that read doesn't just fail, it fails slowly and with escalating slowness: postgres.js backs
  off between reconnect attempts, and every search fires ~21 un-awaited background writes
  (a work upsert per result, plus a health snapshot per provider) that keep the pool failing,
  so the backoff grows. Measured in isolation, the same query on one pool: 9ms, 17s, 27s, 44s.
  The read now has a 500ms budget and degrades to a cache miss past it, which is what the
  durable cache was always meant to be — an accelerator, never a dependency.
- **One slow provider set the pace for the whole search.** `Promise.allSettled` waits for the
  slowest, so DOAJ exhausting its retry budget (3 x 6s timeouts) held every search at ~18s
  while the other providers had answered inside 4s. `fanOutSearch` now has a 9s whole-fan-out
  budget: stragglers are marked and the results that arrived are returned. Straggler calls
  keep running, and `withResilience` caches a late success, so it's ready for the next search
  rather than thrown away.

## [0.3.2] — 2026-07-27

### Added

- Four new LLM backends (Groq, SambaNova, Mistral, Google Gemini via its OpenAI-compatibility
  endpoint) alongside Anthropic and OpenRouter — each a thin config wrapper around a new shared
  `createOpenAiCompatibleProvider()` factory (`lib/ai/llm/openAiCompatible.ts`), since all of
  these APIs speak the same OpenAI-chat-completions shape. `getActiveLlmProvider()`'s
  preference order is now Anthropic > Groq > SambaNova > Mistral > OpenRouter > Gemini,
  live-verified against each real API (Gemini's endpoint/key work but this account's free-tier
  quota is currently zero — kept last for that reason, not model quality).
- Hover-highlighting in the citation graph: hovering a node highlights its own connections
  (thicker, brighter edges; dimmed unrelated nodes) — since clicking a node navigates away to
  the paper's page (0.3.1), this is how connectivity is actually made visible without needing
  to click.

## [0.3.1] — 2026-07-27

Post-release fixes and UI rework based on user testing of Milestone 3.

### Fixed

- **Citation graph nodes never settled — continuous jitter.** `graphData={{ nodes, links }}`
  built a brand-new object literal on every render, including renders triggered by unrelated
  state (e.g. the reasoning panel updating). react-force-graph-2d's underlying force
  simulation treats a new `graphData` reference as "the graph changed" and reheats/restarts —
  fixed by memoizing `graphData` on the actual `[nodes, links]` array references.

### Changed

- **Citation graph click semantics**: clicking a node now opens that paper's page (`doi.org`)
  in a new tab — the graph is for exploring the literature, not just a diagram. Expanding a
  node's own citations moved to right-click (the library auto-suppresses the browser's context
  menu when a right-click handler is provided). Increased link width/hover precision for
  easier edge-clicking.
- **Citation graph is now its own section** (`CitationGraphSection`), not nested inside the
  citation list's small disclosure — larger (520px), its own heading, fetches its own data
  independently. `CitationsPanel` reverted to list-only.
- **Chat and summary UI reworked** for substantially better usability: `react-markdown` (+
  `@tailwindcss/typography`) renders formatted output instead of plain text; `ChatPanel` gained
  real chat-bubble styling (user/assistant visually distinct), auto-scroll, an auto-resizing
  textarea (Enter to send, Shift+Enter for a newline), a typing indicator, per-message copy
  buttons, and a clear-conversation control; `SummaryButton` gained a loading skeleton and
  markdown-rendered output.

## [0.3.0] — 2026-07-27

Milestone 3: interactive citation graph, conversational search, multi-paper synthesis, and
citation reasoning — see `ARCHITECTURE.md`'s "AI-native features (Milestone 3)" section.

### Added

- LLM provider selection layer (`getActiveLlmProvider()`) and a new free-tier backend,
  OpenRouter (`lib/ai/llm/openrouter.ts`) — Anthropic preferred when configured, OpenRouter as
  a fallback. Each backend now declares `models: { cheap, capable }` per task tier instead of a
  hardcoded model string shared across backends.
- Interactive node-based citation graph (`react-force-graph-2d`) — a "Graph view" toggle inside
  `CitationsPanel`. Lazy by-DOI expansion (`GET /api/citations/by-doi?doi=`,
  `getCitationEnrichmentByDoi()`) for papers reached only via a citation edge, never searched
  for directly; capped at ~150 total nodes.
- Conversational/agentic search bar: `POST /api/query-understanding` rewrites free-text input
  into a search query/mode or asks a clarifying question, always falling back to a literal
  keyword search on any failure (not configured, call failure, malformed output).
- Multi-paper synthesis chat: `/api/chat`'s body gained `works: {workKey, title, abstract}[]`
  as a client-supplied alternative to `context`; `lib/ai/synthesisContext.ts` ranks the current
  result set by relevance to the question (reusing the semantic-search embedding cache) and
  feeds the top ~8 as context. A "🧬 Synthesize across these results" entry point above the
  result list.
- Citation reasoning: `POST /api/citations/reasoning` explains a specific citation
  relationship, given both papers' abstracts (a targeted Semantic Scholar lookup for the
  non-root side); cached permanently in a new `citation_reasoning_cache` table. Click an edge
  in the graph view to trigger it.
- 49 new automated tests, plus live verification against the real running app, real Postgres,
  and the real OpenRouter/Semantic Scholar/OpenCitations APIs — including genuinely impressive
  cross-paper synthesis output (correctly distinguishing 5 different CRISPR papers by
  technique) and honest citation reasoning (correctly declining to invent a relationship
  between two topically-unrelated papers).

### Fixed

- LLM `complete()` calls (both Anthropic and OpenRouter) used the generic 6s timeout tuned for
  metadata-fetch API calls — too short for real LLM text generation under normal (non-degraded)
  conditions, discovered live against the free-tier OpenRouter backend. Raised to 30s, matching
  the timeout streaming calls already used.

## [0.2.0] — 2026-07-27

Milestone 2: AI-native features. Semantic search, AI summaries, citation-graph enrichment, and
research-assistant chat, all with graceful degradation when their optional/required
credentials are absent — see `ARCHITECTURE.md`'s "AI-native features" section for the full
design and `KNOWN_LIMITATIONS.md` for what's intentionally deferred.

### Added

- Stable cross-request work identity (`CanonicalWork.workKey`, `lib/ai/workKey.ts`) — DOI or a
  content hash for DOI-less works, both hashed to a uniform URL-safe token. `performSearch()`
  now fire-and-forget upserts every result into the `work` table by `workKey` (previously
  defined since Milestone 1 but never written to), with an abstract-similarity guard against
  the rare cross-response hash-collision case.
- Semantic/natural-language search: `GET /api/search?mode=semantic`, re-ranking the same live
  multi-provider candidate pool by embedding cosine similarity instead of keyword-token overlap
  (`rankWorksBySimilarity`/`scoreWorkBySimilarity`, `lib/merge/rank.ts`). Embedding backend
  auto-detects `OPENAI_API_KEY` (hosted, `text-embedding-3-small`) and falls back to a local,
  no-key-required model (`@xenova/transformers`, `Xenova/all-MiniLM-L6-v2`) — both truncated/
  native to a shared 384 dimensions. New `work_embedding` table, keyed by
  `(workKey, embeddingModelId)` to prevent cross-backend cache poisoning. A keyword/semantic
  toggle in `SearchBar`.
- AI-generated summaries: `POST /api/works/[workKey]/summary` (Anthropic
  `claude-haiku-4-5-20251001`, cached in a new `work_ai_summary` table), a `SummaryButton` on
  each result card. Returns `503` (not a crash) without `ANTHROPIC_API_KEY`.
- Citation-graph enrichment: `GET /api/works/[workKey]/citations`, merging OpenCitations'
  by-DOI COCI API with a new Semantic Scholar citation-detail extension, cached in a new
  `citation_cache` table (1-week TTL). A `CitationsPanel` disclosure on each result card.
- Research-assistant chat: `POST /api/chat`, streaming (Anthropic `claude-sonnet-5` via
  `client.messages.stream()`), plain-text chunked response, no server-side persistence — a
  `ChatPanel` disclosure on each result card.
- 76 new automated tests (Vitest + MSW) covering every new module, plus live verification
  against the real running app, real Postgres, all 9 search providers, the real local
  embedding model, and real OpenCitations/Semantic Scholar citation endpoints.

### Changed

- `CanonicalWork` gained a `workKey` field (see above), computed once in `reconcileCluster()`.
- `SearchRequest`/`SearchCacheFilters` gained a `mode` field; the search-result cache key now
  incorporates it, giving semantic-mode results their own cache namespace per query text
  without a schema change (an omitted/keyword mode still hashes identically to pre-Milestone-2
  behavior, so existing keyword-mode caching is unaffected).
- `lib/merge/rank.ts` refactored to share citation/recency/OA/source-agreement scoring logic
  (`baseScore()`) between keyword and semantic ranking.

## [0.1.1] — 2026-07-27

### Fixed

- **Ranking ignored query relevance entirely.** `scoreWork()` scored purely on citation count,
  recency, source agreement, and open-access status — with no term connecting the score to the
  query itself. This let a paper with tens of thousands of citations but zero relation to the
  query outrank an exact title/author match with a handful of citations (found via a live test
  search for an author's name, where an unrelated highly-cited optimizer paper ranked #1).
  Added a token-overlap relevance term (title/author matches weighted highest) that now
  dominates the score, and `rankWorks()` drops works sharing zero query terms with the work
  entirely rather than merely down-ranking them. See `ARCHITECTURE.md`'s ranking section and
  `KNOWN_LIMITATIONS.md` for the remaining keyword-vs-semantic-matching caveat.

## [0.1.0] — 2026-07-26

Milestone 1: unified multi-source search. First usable release of Scholastic.

### Added

- Project scaffolding: Next.js 16 (App Router, TypeScript, Tailwind CSS v4), pnpm, ESLint, Prettier.
- Project documentation set: `ARCHITECTURE.md`, `ROADMAP.md`, `KNOWN_LIMITATIONS.md`, `SETUP.md`, `PROJECT_LOG.md`, `.env.example`.
- Database layer: Postgres + pgvector via Drizzle ORM, with `search_cache`,
  `provider_health_snapshot`, and `work` tables.
- Resilience layer: in-process LRU cache, circuit breaker, exponential backoff retry, and a
  unified `withResilience()` wrapper with structured (pino) logging.
- Provider adapter framework: common `ProviderAdapter` contract, registry, and
  `fanOutSearch()` orchestrator with graceful per-provider degradation.
- Nine provider adapters, each tested against their real APIs: OpenAlex, Crossref, arXiv,
  Europe PMC, DOAJ, and Semantic Scholar (all no-key or optional-key), plus CORE, Unpaywall,
  and PubMed/NCBI (keyed, credential-based graceful degradation — a provider simply disables
  itself, never fails the overall search, when its credentials are absent).
- Dedup/merge pipeline (`lib/merge/`): DOI-exact + fuzzy (Jaro-Winkler) matching, field-level
  reconciliation into canonical works.
- Ranking (`lib/merge/rank.ts`): weighted-sum scoring by citations, source agreement,
  recency, and open-access status.
- `GET /api/search`: full request contract (`q`, `page`, `perPage`, `yearFrom`, `yearTo`,
  `openAccessOnly`, `minCitations`, `sources`) returning deduped, ranked canonical results;
  always HTTP 200 with `degraded: true` on partial/total provider failure, never a 5xx for
  provider-side issues.
- `GET /api/health/providers`: read-only per-provider health/circuit-state/rate-limit view.
- Provider health snapshots persisted to `provider_health_snapshot` on every resilience-layer
  outcome (fire-and-forget, never affects the triggering search request).
- DB-backed search-result cache (`lib/cache/searchResultCache.ts`): read-through/write-through
  layer over `search_cache`, in front of the in-memory LRU, keyed on query text only so one
  cached fan-out serves every filter/pagination combination; shorter TTL for degraded
  responses.
- Frontend search UI: SSR search page with dynamic metadata, `SearchBar`, `SearchExperience`,
  `FilterSidebar` (client-side year/OA/citations/source filtering sharing the same
  `filterWorks()` logic as the API), `ResultList`/`ResultCard`, `DegradedBanner`,
  three-variant `EmptyState` (no-results / all-sources-down / filtered-to-nothing), and a
  loading skeleton respecting `prefers-reduced-motion`.
- 103 automated tests (Vitest + MSW) covering every adapter, the resilience layer, dedup/merge/
  rank, the search-result cache, and full route-level integration.

### Changed

- `/api/search`'s cache/fan-out/merge/rank logic extracted into `lib/search.ts`
  (`performSearch()`), shared by the route handler and the search page's Server Component.
- OpenCitations removed from the Milestone 1 search fan-out (its API has no keyword-search
  capability); rescoped to a future citation-graph enrichment feature — see `ROADMAP.md`.
- `src/lib/db/client.ts` exposes a lazy `getDb()` getter instead of an eagerly-connected `db`
  export, so importing it (or anything that imports it) never requires `DATABASE_URL` to be
  set unless a query actually runs.
