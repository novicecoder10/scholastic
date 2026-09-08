# Project Log

Running development log, one entry per work session. Newest entries at the top.

---

## 2026-09-07 — the spec's sponsorship features, minus the one that contradicts us

An `OpenSciSpace_Product_and_Technical_Spec.md` appeared in the tree, untracked, marked
"Approved / Architecture Baseline". Its module boundaries match this app almost exactly, so most
of it is a description of what exists. This session built the parts of Module 7 that were only
described, and skipped the one that argues with a decision already made.

**What was skipped, and why it stays skipped.** §4.1 specifies
`POST /api/v1/sponsorship/keys` taking a raw `api_key` in the request body, "encrypted at rest".
That is the exact thing `capacity_source.credential_ref` exists to avoid, and the CLI header has
said so since #6: a web form that accepts a pasted key would be the worst thing this project
could build. Encryption at rest does not change who holds the key, only where it is written
down. The requirement was not implemented and the reason is recorded rather than left as an
apparent oversight.

**What the same requirement wanted, built a way that keeps custody with the sponsor.** SPON-03
and SPON-04, which are the interesting half: an `outpost` is a relay the sponsor runs and never
hands over, and a `node` is cluster hours donated on a schedule. Both are a URL plus a model id.
Nothing new is secret — a relay's bearer token is named by `credential_ref` like every other
credential, and a node on a private network has none at all, the sole case where that column may
be null.

The scheduling detail worth writing down: a window that wraps past midnight is measured against
the day it **opened** on. `18:00-06:00` on days 1-5 is the shape almost every off-peak donation
takes, and measuring it against the current day would end a Friday-evening donation at midnight
and start a Saturday-morning one nobody offered.

**SPON-05, the dispatcher.** `selectCapacity` used to pick one provider; it now returns a
dispatcher over the whole ranked pool. A source answering 401/402/403/429 is tripped dormant and
the request moves on. Two limits were deliberate: a 400 is not retried anywhere, because it will
fail identically everywhere and replaying it spends another sponsor's quota to learn nothing;
and a stream never fails over once it has yielded a token, because splicing two answers together
mid-sentence is worse than an honest error.

**The bug that only a live run could find.** Unit tests for the dispatcher passed. Run against a
stub endpoint that always answers 429, the failover worked perfectly — the user got their
paraphrase from the next source — and the dormancy write failed into a warning log, because the
CHECK constraint from 0014 allows three statuses and `dormant` is a fourth. Best-effort writes
hide their own failures by design; that is the argument for exercising them against a real
database, not for making them blocking. Fixed in 0018, and deliberately not by editing 0017,
which had already been applied: a migration that has run is history.

`pnpm db:generate` could not be used for either migration. The drizzle meta snapshot has drifted
from `schema.ts` — it still holds tables like `author` and `venue` that no longer exist — so the
generator opens an interactive rename prompt and cannot run non-interactively. Both migrations
are hand-written, which is this repo's existing convention anyway; the snapshot drift is noted in
KNOWN_LIMITATIONS.md rather than fixed blind.

**Two smaller things.** SPON-06 attribution, opt-in twice over (public _and_ named), which is the
only return a sponsor gets. And REVW-04's Markdown matrix export, sitting beside the CSV: the
same table for pasting into a draft, page numbers beside the values and the quotes underneath
rather than dropped to make it fit.

---

## 2026-09-06 (later) — the Soon chips, and two bugs the user found by looking

The nine were done, so this session was the user driving the running app and pointing at what
was wrong. Every item below came from a screenshot, not from a test.

**The three "Soon" chips.** Two of them already existed and had simply never been wired: _Draft_
is #8, _Diagrams_ is #9. Wiring took twenty lines. The interesting decision was the name — the
citation graph is the only diagram this app draws, so the chip is _Citation map_ now. Shipping a
chip called _Diagrams_ next to a search engine implies figure generation, and a promise the app
does not keep is worth less than a narrower promise it does.

_Presentation_ was genuinely new, and it is #8's argument in a different shape: a deck outline
where every bullet carries a citation and the guard deletes the ones that do not. A slide is
where an uncited claim travels furthest — it gets photographed and quoted by people who never
saw a reference list — so the mechanical filter matters more here than in a manuscript, not
less.

**The tag fix, which the first live run forced.** The prompt asked the model to cite exact
workKeys, the way the manuscript drafter does. Six slides came back and the guard deleted all of
them: 15 foreign citations, because `doi:10.1038/nbt.3117` is a long punctuated string a model
paraphrases or truncates, and a key one character wrong is indistinguishable from an invented
one. The model is shown `S1..Sn` now and `remapCitations` translates afterwards. Same run, same
query: six slides, zero dropped. The guard was never the problem — it was doing exactly its job,
loudly, which is how the problem got found in one run instead of ten.

**The superscript bug.** The user sent a screenshot of a resource-comparison table rendered with
five columns against a four-column header, every value after the formula shifted right. Cause:
`O((log p)^3)` reaches pdfjs as five items, and the detector clustered their _start-x_ — which
throws away width, the one measurement that separates a column gutter from an ordinary space.
Columns are the occupied bands of the x axis now. The rewrite deleted `clusterPositions` and the
left/right-alignment tie-breaker: once a column is a band, alignment stops being a question the
code has to answer. I also wrote a guard for spanning group headers, discovered it was
unreachable — `findRegions` ends the run at a gapless line before `buildGrid` ever sees it — and
deleted it rather than leave a plausible-looking rule that never fires. It is in
`KNOWN_LIMITATIONS.md` instead.

**The arXiv bug, which nobody reported.** Chasing the deck's first failure, `/api/deck` returned
"couldn't reach the search providers" — and the log showed six providers succeeding, then
`e.trim is not a function`. arXiv served a record with four identical `<arxiv:doi>` elements;
the XML parser collapses repeats into an array; `doi` arrived at `normalizeDoi` as `string[]`
and threw from inside `clusterWorks`. TypeScript believed the mapper's `string | null` because
the parser hands back `any`, so the type system was never going to catch it. Fixed at the mapper
and again at `normalizeDoi`, because this app's whole stance is that one provider's bad day
never fails a search — and a malformed _record_ deserves the same treatment as a dead provider.

That one is worth remembering as a category: the search had been 500-ing on an ordinary query
for as long as arXiv has served that record, and no test caught it because every fixture is
well-formed. Recorded fixtures test the parser; they cannot test the parser's assumptions.

**Two small deletions.** The `Tools ▾` pill did nothing, and the matrix grid printed its own
title inside its help text (`sllep· A blank cell means…`) directly under the `h1` that already
said it.

Ends at 720 unit tests and 29 end-to-end, everything green, nothing committed.

---

## 2026-09-06 — #9: the refactor was the feature

Shipped the last of the nine. The citation graph was a 520px canvas inside one result card,
seeded from one paper and expanded by right-clicking — it worked, and it was a curiosity.

The spec called the refactor the feature and it was right. All 317 lines of graph logic lived
inside `CitationGraph.tsx`, so none of it could be tested, and `src/lib/graph/` had been sitting
empty since the scaffold. Pulling identity, building, analysis and filtering out into pure
modules produced 48 tests covering behaviour that previously had none — and everything else in #9
was only safe to attempt afterwards.

The single most valuable test is the least glamorous one: `mergeGraph` returns the _same array
references_ when nothing changed. There was a hard-won comment in the old component explaining
that `react-force-graph-2d` treats a new `graphData` object as a changed graph and reheats the d3
simulation forever. A comment is a hope; `expect(twice).toBe(once)` is a guarantee.

Node identity was the other structural fix. `nodeIdFor()` invented its own id shape, so a graph
node and a search result for the same paper were different things. Nodes carry the app's own
`workKey` now. The feared per-node lookup cost turned out to be mostly imaginary — most citation
refs carry a DOI, and `doi:<normalised>` needs no lookup at all. For the DOI-less tail I resisted
matching on title: a stable `unresolved:` hash with a flag is honest, and a title match is how a
graph starts asserting edges between papers that are not the same paper. Deliberately _not_ the
app's `title:` shape either, which means "a work we have seen and normalised".

Two interaction fixes that the old component's own comments had already conceded. Right-click to
expand was undiscoverable and impossible on touch — the tell was the paragraph of prose
explaining it. And clicking a node opened doi.org in a new tab, which the hover comment admitted
made it impossible to "just look". Click now selects, double-click expands, arrow keys walk the
edges, and the doi.org jump is a link in the inspector.

I also gave the canvas an accessible fallback: the same nodes and edges as real DOM inside a
`<details>`, with the same select and expand actions. A canvas graph is otherwise completely
invisible to a screen reader, and this app already does that work elsewhere.

The multi-root form needed one algorithmic decision. Seeding from twenty search results and
draining each seed's references in order spends the entire 150-node budget on the first two
papers, which defeats the whole point — the point being to see that four of twenty results cite
the same 1998 paper. Round-robin across the seeds; shared ancestors dedupe and cost nothing
extra. Verified live: 20 roots, 150 nodes, 14 clusters.

The constraint I care most about is the labelling. Every computed number says "within the loaded
subgraph", because citation coverage is incomplete and biased and none of these figures is a
property of the literature. It is also why I did not add LLM narration of clusters: a generated
paragraph explaining what a cluster "represents" launders incomplete data into confident prose.
Edge-level citation reasoning stays, because it is grounded in two specific named papers. Those
are not the same thing.

688 unit tests, 25 end-to-end, typecheck and lint clean.

All nine sub-projects are shipped.

---

## 2026-09-06 — #8: a citation is an object

Shipped sub-project #8: `/write`, a manuscript editor where citations are live objects.

One decision carries this whole feature. A citation node stores a workKey and nothing else — no
number, no author-year string, nothing about how it renders. Every property people want from a
reference manager then falls out for free: reordering paragraphs renumbers, switching APA to MLA
is a re-render rather than a rewrite, deleting a sentence removes its bibliography entry, citing
the same work twice produces one entry. It is also the only reason to pay ProseMirror's
complexity instead of shipping a markdown textarea.

The corollary took a live probe to notice. I offered all five of #4's citation styles in the
manuscript's style selector, and picking BibTeX produced a Markdown export whose references
section was a list of `@article{...}` entries. BibTeX and RIS are _interchange formats_, not
prose styles; they have no inline label and no place in a rendered bibliography. A manuscript
takes APA, MLA or Chicago, and BibTeX/RIS remain exports. Fixing that also removed a fake
numeric-label branch and let MLA do the right thing in-text (author alone — a bibliography has no
page number to give).

The generative mode is deliberately narrow, and the constraint is in code rather than in the
prompt. The model writes citations as `[[workKey]]`, then `validateDraft` strips any sentence
with no citation and any citation naming a work outside the chosen set. The two rules compose: a
sentence whose only citation was foreign becomes uncited and goes too. If that empties the draft,
nothing is inserted and the panel says why. Inserting unattributed prose into somebody's
manuscript is the failure I built the guard to make impossible, not to make unlikely.

Same reasoning for find support: it ranks candidates and requires a pick. There is no confidence
threshold above which it cites for you. A wrong citation is worse than no citation — it reads as
authoritative, it is rarely re-checked, and it survives into the published version.

Two smaller things I am glad I wrote down rather than assumed. The relabelling transaction sets
`addToHistory: false`, because derived state must not eat a step of the writer's undo stack. And
`manuscript.userId` is NOT NULL — the only place in the app that refuses anonymous ownership —
because a manuscript tied to a browser cookie is a data-loss trap dressed as convenience.

Verified live: chips render `(Brand, 2011)` under APA and `(Brand)` under MLA with no document
change, the Markdown export carries the active style, the LaTeX `\cite` keys match the `.bib`
keys exactly, and a grounded draft inserted five sentences each carrying a citation node. The
draft's first attempt called its sources "Paper 1", which is a prompt-quality problem rather than
a correctness one; one added instruction fixed it.

640 unit tests, 21 end-to-end, typecheck and lint clean. Next: #9, the citation-graph explorer —
the last one.

---

## 2026-09-06 — #7: numbers with receipts, and a subquery that never correlated

Shipped sub-project #7: table and statistic extraction in the reader, and `/matrix`, an evidence
matrix for systematic-review work.

The structural call is that tables and prose statistics are **two different problems**. Tables
are geometry; reported statistics are semantics. The tempting shortcut — flatten the page to
text, ask a model for structure — is exactly how a number ends up in the wrong row, because
pdfjs emits text items in draw order rather than reading order. So `lib/pdf/tables.ts` is pure,
sees no model, and is tested against recorded item arrays rather than parsed PDFs.

Writing the false-positive test paid for itself immediately. A page of two-column prose came out
as a confident 2×4 table, and it _should_ have: occupancy 1.0, row consistency 1.0. Geometry
alone cannot tell a paragraph from a data column. What separates them is cell length — a table
cell is a label, a count or a measurement — so brevity became the third factor in the confidence
score rather than a filter bolted on afterwards.

The part I care most about is the non-invention guard, and specifically its second half. It is
easy to check that a quote appears in the source. The check people forget is that the _value_
appears in its own quote: "we recruited participants across three sites" cited for a sample size
of 412 is a real quote attached to an inferred number, and it reads as provenanced. Both checks
are mechanical, so "the model never invents a number" is a property of the code rather than a
hope about a prompt.

Similarly, `not_reported` is a status and not an empty string. A blank cell must mean the paper
does not report that field, never that the extractor gave up — those are different facts about
the literature. A cell that claims "found" but cannot be quoted degrades to "not reported", and
a CHECK constraint makes a provenance-free `found` cell unstorable at all.

The bug of the day: a brand-new matrix reported 2 papers and 2 fields. The cause is worth
remembering — drizzle qualifies column references with their table only when the query needs it,
so a plain single-table select emits bare `"id"` and `"matrix_id"`. Inside my hand-written
correlated subquery both resolved against the _inner_ table, so it compared
`matrix_row.matrix_id` to `matrix_row.id`, never correlated with the outer row, and returned a
number that looked plausible. Joins with `count(distinct ...)` instead, and an integration test
against real Postgres that asserts a fresh matrix is empty.

Two hours went into a 404 that was not a product bug at all. `page.request.get()` in Playwright
drops the `Secure` anonymous-session cookie over plain http where the browser keeps it, so the
export endpoint answered 404 to its own owner — which looks precisely like the ownership bug it
would be if it were real. A curl cookie jar against the same server returned 200, which is what
separated harness from product. The e2e test fetches from inside the page now, with the reason
written down.

The Groq reasoning-model trap from #4 bit again, and harder. Findings extraction returned nothing
about half the time: `finish_reason: "length"` with an empty string at 2000 tokens, because the
trace is billed before any content. Then five sequential calls with 2k-token excerpts tripped the
per-minute token limit and the rest came back 429. Fixed by asking for less rather than by
inflating the budget again — three retrieval queries instead of five, three excerpts instead of
eight, an explicit "do not explain your reasoning", and stopping at the first 429. Verified live
afterwards: correct values, correct pages, verbatim quotes.

600 unit tests, 18 end-to-end, typecheck and lint clean. Next: #8, the AI writer.

---

## 2026-09-06 — #6: a commons, and the token bill nobody was paying

Shipped sub-project #6. Credits allocate a shared pool of donated AI capacity — never for sale,
never transferable, never earned by using the app.

The structural decision is keeping three things apart that every metering system I have seen
conflates: capacity (real provider quota), credits (a claim on it), and contribution (what mints
a claim). Because they are separate, the exchange rate can change without touching the ledger,
and a capacity shortfall never corrupts anyone's balance.

The one I feel strongest about: `capacity_source` stores the **name** of an environment
variable, never a key. Sponsorship is operator-mediated through a CLI. A web form that accepts a
pasted API key would be the worst thing this project could build, so the reason is written into
the schema comment, the docs, and the CLI's own validation — it has to survive being
re-proposed later as a convenience.

`recordUsage` was documented as "must never affect the response", and debiting has to be
reliable. Rather than compromise either, they happen at different moments: pre-flight blocks
before anything is spent, the debit runs afterwards on real token counts and is allowed to fail.
A dropped debit undercharges by one operation; a debit that breaks a response the user already
received is a bug they experience.

Two things I found only because I looked at the real system afterwards.

First, `streamComplete` had never reported token usage at all. Chat and rewrite — the two most
expensive features in the app — would have streamed for free forever. Fixed by asking
OpenAI-compatible backends for `stream_options: { include_usage: true }` and assembling
Anthropic's counts from `message_start` plus `message_delta`.

Second, and the better story: after a live summary the ledger showed a debit but
`capacity_source.tokens_used_period` was still 0. The warning said only `Failed query: update
...`, which is drizzle wrapping the driver error and discarding everything useful — the exact
blindness that hid the 23505 duplicate-collection bug in #5. So I wrote `describeDbError()` to
walk the `cause` chain, and the real error appeared immediately: `ERR_INVALID_ARG_TYPE ...
Received an instance of Date`. A raw `sql` fragment carries no column type, so a JS `Date` in a
`SET` reaches postgres.js as an untyped parameter. Computing the month boundary in SQL fixed it
and made the rollover independent of the Node process's timezone as well. Twice now the same
wrapper has cost me an hour; the third time it will cost minutes.

The false lead worth recording separately: an earlier probe "reproduced" a #5 bug that did not
exist, because a leftover `next start` was still holding port 3100 and I was testing an old
build against new code. Check what is actually listening before believing a negative result.

I also deleted `getLlmProviderForTask` rather than fixing it. It ignored its `tier` argument and
carried the repo's one standing eslint warning since Milestone 3. There was no honest tier-aware
behaviour to give it at that layer — tier only means something once there is a pool of sources
to choose between — so the placeholder went and `lib/capacity/sources.ts` took the job.

Two smaller real bugs fell out along the way: `verifySession` was swallowing Next's
`DynamicServerError`, the throw Next uses to signal "this route can't be static", so every
prerendered route logged a session failure and was told the visitor was signed out;
`unstable_rethrow` fixes it. And `app/loading.tsx` was the nearest loading state for every
route, so a search-results skeleton flashed in front of the sign-in form, the library and the
credits page — moved into an `(search)` route group.

Hard constraint, stated once so it stays stated: no leaderboard, no public badge, no profile.
A credit score attached to a researcher and shown publicly is a reputation metric, and
academia's existing ones have a documented history of being gamed. Keeping balances private
removes the incentive structurally rather than policing it.

541 unit tests, 15 end-to-end, typecheck and lint clean — the lint warning count is now zero for
the first time. Next: #7, extract data.

---

## 2026-09-06 — #5: accounts, and the two bugs only a browser could find

Shipped sub-project #5: optional accounts, a library of saved papers and uploads, collections,
and adoption of anonymous uploads on sign-up.

The design decision everything else follows from is that accounts are **optional**, the same
way every search provider and the LLM layer are. No `BETTER_AUTH_SECRET`, no accounts — `/login`
answers 503 and the app is exactly what it was before. That is a check rather than a default on
purpose: a generated fallback secret would invalidate every session on restart, which is worse
than a feature that is visibly switched off. The opposite call from `SESSION_SECRET`, where the
fallback keeps a strictly local feature usable for one process.

Adoption is one `UPDATE` filtered on `ownerSessionId = :sid AND user_id IS NULL`. The `IS NULL`
is not defensive; it is the whole security of the operation. Without it a second person signing
in on a shared browser inherits the first person's uploads, because they share a cookie. Signing
out rotates that cookie for the same reason.

I brought Playwright forward from its place at the end of the roadmap, because #5 is the first
sub-project whose correctness lives entirely above the unit-test layer: cookies crossing a
redirect, adoption reading a user id off a response the request cannot see, one browser holding
two identities. It paid for itself on the first run by catching a rate-limit configuration that
locked out ordinary browsing — a flat 20/minute per address also applied to `get-session`, which
the root layout calls on every page load, so an office behind one NAT address would have been
throttled out of the site. I fixed it with an `AUTH_RATE_LIMIT=off` escape hatch, then removed
that: `next start` sets `NODE_ENV=production`, so the guard meant to keep the hatch out of
production was already defeated by the suite it was added for.

Then two failing tests I first wrote off as flakiness, and both were real product bugs.

The save test clicked Save, saw it succeed, then reloaded and found the paper unsaved. The trace
showed a single `POST /api/library/items` returning 201, so the write was fine. `savedWorkKeys`
— which I had written, tested against real Postgres, and never called — was the answer:
`SaveButton` always started from `initiallySaved = false`, so a paper already in your library
offered to save itself again. The results page now resolves saved state server-side in one query
for the whole page.

The collection test created a collection and did not see it. `router.refresh()` does land, but
it re-renders the page on the server and takes a second or more; a 1.2s probe saw nothing and a
4s probe saw it. Creation now renders what the API returned and lets the refresh supersede it.

The false lead worth recording: a probe that "reproduced" the save bug at first didn't — a
leftover `next start` from a previous run was still holding port 3100, so I was testing an old
build against new code. Killing it and rebuilding made the same probe pass. Check what is
actually listening before believing a negative result.

Smaller things the database taught me: `ON CONFLICT` against a partial unique index needs the
predicate restated (drizzle's `targetWhere`, Postgres 42P10); drizzle wraps driver errors in
`Error: Failed query: …` carrying neither SQLSTATE nor constraint name, so duplicate detection
has to walk `err.cause` for `23505`; and migration `0012` was silently skipped because `0011`'s
hand-written journal timestamp had been rounded into the future. Also caught, before it ran, a
hand-built `ARRAY[...]` literal in `savedWorkKeys` taking strings straight from a request body —
replaced with `inArray`, with a test whose workKey contains a quote.

12 end-to-end tests, 490 unit tests, typecheck and lint clean. Next: #6, credits and
sponsorship.

---

## 2026-09-06 — Why searches kept getting slower

Follow-up to the feedback fix below: the portal was genuinely slow, not just silent about it.

The symptom that cracked it was that slowness _accumulated_. Timing four cold searches against
a freshly started server gave 3.6s, 60s, 66s, 79s. Something was getting worse with use, which
ruled out the providers.

Timestamping every log event inside one request showed 54 seconds of total silence before the
fan-out even began, ending in `search_cache_read_failed`. The first guess — that postgres.js
was using its default 30s `connect_timeout` — was wrong: a raw probe refused in 9ms, because
nothing is listening and ECONNREFUSED is immediate.

The real mechanism showed up by replaying the access pattern on one pool: a foreground query
took 9ms on a fresh pool, then 17s, 27s, 44s after each round of 21 un-awaited background
queries. That is the app's own write pattern — `persistWorks()` fires one upsert per result
and `persistHealthSnapshot()` one per provider, all un-awaited. Against a dead host they keep
the pool failing, postgres.js lengthens its reconnect backoff, and the one DB read that _is_
on the critical path (the durable search-cache lookup) queues behind it.

Fix: give that read a 500ms budget and treat an overrun as a miss. The durable cache is an
accelerator, never a dependency — the providers can always answer without it.

Second, unrelated cost found in the same timeline: `Promise.allSettled` pins the fan-out to
its slowest member, so DOAJ burning 3 x 6s timeouts held every search at ~18s while everything
else finished inside 4s. Added a 9s whole-fan-out budget that returns what arrived and marks
the stragglers. Stragglers keep running and a late success still lands in the provider cache.

Cold searches went from 60-79s to a steady 3-9s. `connect_timeout: 5` stayed in as a cheap
guard for the case ECONNREFUSED doesn't cover: a host that accepts packets but never answers.

Worth noting for whoever runs this next: `.env.local` points at `localhost:5433`, while
SETUP.md's docker command publishes 5432, and nothing is listening on either. Everything above
is real and worth having regardless, but with Postgres actually up, the durable cache also
starts doing its job across restarts.

---

## 2026-09-05 (later) — Search submit gave no feedback

Ran the portal locally (`next start -p 3311`; port 3000 is held by an unrelated project) and
hit a real bug: submitting a search appeared to do nothing.

Reproduced with a headless-browser script that polls the URL, the button label, and the
result count once a second. It showed 23 seconds between the click and any visible change —
the button read "Search" from t=1s onward, and even the URL stayed `/` the whole time.

Root cause was a mismatch between two clocks. `SearchBar.runSearch()` awaits
`/api/query-understanding` (~1s), calls `router.push()`, and clears `understanding` in its
`finally`. But `push()` is fire-and-forget, and the results page is a Server Component that
fans out to nine providers, so App Router won't commit the navigation — not even the URL —
until that render finishes. The only pending indicator therefore ended ~22 seconds before
the work did. `loading.tsx` was no help: per
`node_modules/next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md`, its
fallback is shown for a _prefetched_ route, and a programmatic `push()` never prefetches.

Fix: run the navigation inside `useTransition()` and derive a single `pending` value from
`understanding || isNavigating`. Verified with the same script — continuous feedback now,
"Thinking…" then "Searching…", results at 15s.

Worth noting what was _not_ the cause: the `work_persist_failed` warnings flooding the log
(Postgres isn't running locally) are harmless here, because `persistWorks()` returns `void`
and is never awaited. The 15s is genuine provider latency; a warm cache serves the same query
in 0.06s. Streaming/incremental results is already on the roadmap and is the real answer.

---

## 2026-09-05 — Visual redesign (sub-project #1 of 9), and the state of the git tree

- Asked what was pending; the honest answer had two halves. (a) Nothing built since Milestone 1
  is committed — `HEAD` is still the scaffold plus specs, and all of Milestones 1–3 (~5,700
  changed lines, plus every file under `src/lib`, `src/components`, `src/app/api`) lives in the
  working tree. (b) The approved spec
  `docs/superpowers/specs/2026-08-23-scispace-visual-redesign-design.md` (sub-project #1 of the
  nine-part product sequence) had not been started at all. User asked for everything, with the
  commit left to them.
- Implemented sub-project #1 in full, presentation-layer only:
  - Palette as CSS custom properties in `globals.css`, exposed as Tailwind utilities through
    `@theme inline`. Dark-first: dark values on `:root`, light values redefined under
    `prefers-color-scheme: light`. Because the swap happens at the token level, components no
    longer need `dark:` variants for color at all — the leftover ones are `prose` classes.
  - `TopNav` in the root layout, wrapped in `<Suspense>` (it calls `useSearchParams`, which
    opts its subtree out of prerendering — confirmed against
    `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-search-params.md`
    rather than assumed). `/health` is finally reachable from the UI.
  - `HomeHero`: task box + quick actions. `Literature review` needed a way to land on results
    with the synthesis chat already open — did it with a `?view=review` param threaded through
    `page.tsx` → `SearchExperience` → `ResultList` → a new `ChatPanel defaultOpen` prop, so no
    backend or route change was needed, matching the spec's "rewire, don't rebuild" constraint.
  - Design decision beyond the spec's letter (it left "differentiate through typography,
    spacing and interaction detail" open): a **provenance spine** on each result card — nine
    ticks, one per source, lit for the sources that actually returned that record. It's the one
    ornamental-looking element in the design and it is not ornamental: cross-source agreement
    is a ranking input, so the strip visualizes something true. The wordmark reuses the motif.
- Verified with Playwright screenshots against a production build (home/results/health, dark
  and light, mobile, chat open, summary error state). Two real bugs surfaced only in the
  screenshots, both now fixed: long venue names overflowed the filter sidebar into the results
  column, and `globals.css` had been silently overriding Geist with Arial since the scaffold.
  The overflow was not a flexbox mistake: `<fieldset>` carries a UA
  `min-inline-size: min-content` that Tailwind's preflight leaves alone, so the sources/venue
  fieldsets grew to their longest label no matter what the sidebar's width was. `min-w-0` on
  the fieldsets (plus truncation on the label) is the fix — worth remembering, since every
  filter panel in this app is built out of fieldsets.
  Also fixed a duplicate-`id` a11y bug found while restyling (`ChatPanel` hard-coded
  `id="chat-input"`, so every open panel on the page shared it) — now `useId()`.
- Sandbox notes: two dev servers were already occupying ports 3000/3002 (one of them a
  different project entirely), and `next dev` refuses a second instance from the same
  directory; `networkidle` never settles against `next dev` because of the HMR socket. Ended
  up screenshotting `next start` on port 3311, which is closer to the real thing anyway.
- Renamed the product to **Scholastic** everywhere user-visible (nav wordmark, page titles,
  chat system prompts) and in the docs. The repo, and now the spec, called it Scholastic while
  the UI and docs said ScholarAI.
- Verification: `tsc --noEmit` clean, `eslint` clean (one pre-existing unused-arg warning in
  `lib/ai/llm/index.ts`), 278 unit tests pass, `next build` succeeds. 0.4.0.
- Not done, and deliberately so: sub-projects #2–#9. Each is specified to get its own
  brainstorming round and spec first, and they involve real product decisions (accounts,
  gamification economics, PDF ingestion) that shouldn't be invented unilaterally.
- Still nothing committed to git — the user is doing that themselves.

## 2026-07-27 (cont. 3) — Citation graph connectivity fix + four new LLM backends

- User reported clicking a node now correctly jumps to the paper (0.3.1's fix), but wanted the
  graph's actual _connectivity_ (which papers connect to which) to be visible too — since a
  click now navigates away, there was no way to just look. Added hover-highlighting: hovering a
  node highlights exactly its own edges (thicker, brighter blue) and dims unrelated nodes,
  making connectivity legible without needing to click.
- Mid-task, user provided four more of their own, individually-labeled API keys in sequence
  (Groq, Google AI Studio/Gemini, SambaNova, Mistral) — each accepted on the same basis as the
  earlier OpenRouter key (a single, clearly-attributed personal credential), unlike the earlier
  refused unlabeled 50-key dump. Live-verified each key/endpoint directly via curl before
  writing any code, including discovering: (a) Gemini's OpenAI-compatibility endpoint and key
  both work, but this account's Google Cloud free-tier quota is currently zero (an account-side
  config issue, not a code bug) — wired in anyway for when it's resolved; (b) a few free/trial
  models on both OpenRouter and SambaNova exhibit a "hidden reasoning" quirk where they burn
  their entire token budget on invisible reasoning tokens and return empty content for short
  prompts — avoided as defaults in favor of models confirmed to return direct output
  (`gemma-4-31B-it`, `DeepSeek-V3.1`, etc.).
- Refactored the LLM provider layer: extracted `createOpenAiCompatibleProvider()`
  (`lib/ai/llm/openAiCompatible.ts`), since Groq/SambaNova/Mistral/OpenRouter/Gemini all speak
  the same OpenAI-chat-completions-compatible shape — each concrete provider is now a ~15-line
  config wrapper (base URL, env var names, default models) instead of duplicating the same
  fetch/SSE-parsing logic five times. `getActiveLlmProvider()`'s preference order: Anthropic >
  Groq > SambaNova > Mistral > OpenRouter > Gemini (genuinely-free and fastest options first,
  the currently-non-functional one last).
- User asked directly how "a literal collection of APIs" would actually be used — clarified
  that exactly one provider is selected per request (a static preference-order pick based on
  which keys are configured), not all of them at once, and that there's no automatic runtime
  failover if the selected one fails mid-request (each call still gets its own retry budget via
  the existing `withResilience` wrapper, same as every other external dependency).
- Live-verified end-to-end: with Groq now the top _working_ configured provider (Anthropic
  still unset), a real summary generation completed in 0.68s — confirming Groq's speed
  advantage is real, not just a claim from its marketing.
- Moved the test suite's shared HTTP/SSE-parsing test coverage into one
  `openAiCompatible.test.ts` (testing the factory directly against a fake config) rather than
  duplicating full behavioral tests across five near-identical provider files; each concrete
  provider file now just checks its own wiring (env var, default models). 274 tests total (up
  from 251), clean typecheck/lint/build. 0.3.2.
- Nothing committed to git. All five new keys stored only in `.env.local` (gitignored), never
  printed in full or committed.

## 2026-07-27 (cont. 2) — Post-Milestone-3 fixes and UI rework

- User reported the citation graph "having issues" and asked for two structural changes:
  pull it out of the small citations disclosure into its own section, and make nodes/edges
  clickable through to the paper's actual page. Also asked for a substantial UI rework of AI
  summaries and chat ("as good as chatting to ChatGPT").
- Also in this exchange: user asked me to save a list of ~50 unlabeled `sk-`-prefixed strings
  as API keys. **Declined** — unlike the OpenRouter key from the previous session (a single
  key, given directly, for the user's own account), this was an unattributed bulk list with no
  stated provenance or target service, arriving right after the earlier refused
  scrape-GitHub-for-keys request. This app also has no legitimate use for 50 keys. Explained
  the distinction and asked what service they're actually for rather than silently discarding
  or silently storing them.
- Found the real bug behind the graph's reported issues via code review (no browser tool
  available/installed this session): `graphData={{ nodes, links }}` in `CitationGraph.tsx`
  created a new object literal on every render — including renders triggered by unrelated
  state changes (e.g. the reasoning panel updating after an edge click). react-force-graph-2d's
  underlying d3-force simulation treats a new `graphData` reference as "the graph changed" and
  reheats/restarts the physics simulation, so nodes would never settle and would jitter
  continuously. Fixed by memoizing `graphData` on the actual `[nodes, links]` array references.
- Redesigned click semantics: left-click a node now opens that paper's page (`doi.org`) in a
  new tab (confirmed via the `force-graph` library's own source that providing a right-click
  handler makes it auto-suppress the browser's context menu, so right-click cleanly became the
  "expand this node's own citations" action instead of overloading a single click with two
  meanings).
- Extracted the graph into its own `CitationGraphSection` component — a separate, larger
  (520px), independently-data-fetching section with its own heading, no longer nested inside
  `CitationsPanel`'s small disclosure (which reverted to list-only, as it was before Milestone
  3 added the graph-view toggle).
- Reworked `ChatPanel` and `SummaryButton` substantially: added `react-markdown` +
  `@tailwindcss/typography` so AI output actually renders as formatted text (paragraphs, lists,
  bold, etc.) instead of a single unstyled blob. `ChatPanel` gained real chat-bubble styling
  (user messages right-aligned/blue, assistant left-aligned/neutral), auto-scroll to the latest
  message, an auto-resizing textarea with Enter-to-send/Shift+Enter-for-newline, an animated
  typing indicator while waiting for the first token, per-message copy buttons, and a clear-
  conversation control. `SummaryButton` gained a loading skeleton and markdown rendering.
- Live-verified the backend routes are unaffected (only frontend/component changes this pass):
  a real summary generation and the existing citation graph API endpoints both still work
  correctly end-to-end. Could not visually verify the actual canvas rendering/interaction in a
  real browser — no browser-automation tool was available (the user started but did not
  complete installing the Chrome extension this session) — verified via code-level diagnosis
  of the concrete bug, typecheck/lint/test/build, and SSR/curl structural checks instead.
- 0.3.1. `pnpm test` stays at 251/251 (no new automated tests this pass — pure UI/behavior
  rework of existing, already-tested API surfaces). Nothing committed to git.
- Next: if the graph or chat/summary UI still has issues after this fix, the user will need to
  describe symptoms directly (or complete the Chrome extension install) since this session had
  no way to visually confirm the fix.

## 2026-07-27 (cont.) — Milestone 3: Citation Graph, Conversational Search, Multi-Paper Synthesis, Citation Reasoning, shipped

- User asked for a large wishlist of features in one message, including "add free ai api keys
  by scraping github or any such places." **Refused that specific request plainly** — keys
  found by scraping public repos/etc. are virtually always leaked credentials belonging to
  someone else's account; using them is unauthorized use of a paid service on another person's
  dime. Explained the legitimate alternative (real free tiers: OpenRouter, Gemini, Groq,
  Hugging Face Inference API) and offered to wire one in if the user signed up themselves.
- Scoped the rest of the wishlist down via AskUserQuestion — it was a full product roadmap
  (persistent research memory, autonomous research agents, a reproducibility workspace, etc.),
  not one task. User selected 4 of the 8 proposed items for this milestone; confirmed
  leaving accounts/auth (needed for persistent memory) and full-text/PDF ingestion (needed for
  a reproducibility workspace) for a later, dedicated foundation-design pass rather than
  half-building either now.
- Mid-planning, user pasted their own real OpenRouter API key directly in chat and asked to
  proceed without waiting for approval. **This is categorically different from the earlier
  refused request** — a freely-given credential for the user's own account, not a
  scraped/leaked one — so accepted it, verified it live (real `chat/completions` calls,
  `cost: 0`, confirming genuine free-tier usage), and folded it in as a new LLM backend
  (`lib/ai/llm/openrouter.ts`) added as a prerequisite task, since every other item in this
  milestone needs an LLM call. Stored only in `.env.local` (gitignored), never in a committed
  file or printed in full.
- Ran a dedicated architecture-review pass (Plan subagent) before building. It corrected:
  derive citation-graph expansion-node cache keys via the _existing_ `getWorkKey()` DOI branch
  rather than a new scheme (so an expansion node's cache entry and a later "actually searched
  for this paper" row converge automatically); keep multi-paper synthesis context entirely
  client-supplied rather than adding a new server-side `work`-table read with no defined
  degradation behavior; cache citation-pair reasoning permanently (like `work_ai_summary`),
  not with the citation list's 1-week TTL; use the query-param form for the by-DOI route
  (`?doi=`) rather than a dynamic path segment, since a DOI's `/` becomes `%2F` when encoded
  and dynamic segments are a known source of silent 404s for that; pick `react-force-graph-2d`
  (the dedicated 2d sub-package) over hand-rolling a graph renderer.
- **Interactive citation graph**: `react-force-graph-2d`, lazy by-DOI node expansion (new
  `GET /api/citations/by-doi?doi=` route + `getCitationEnrichmentByDoi()`, refactored out of
  the existing workKey-based enrichment), capped at ~150 nodes, edge-click reasoning. Live-
  verified: fetched real citation data for a DOI never searched for directly, expanded a second
  hop, confirmed `citation_cache` rows accumulate correctly keyed by the shared `getWorkKey()`
  scheme.
- **Conversational search bar**: `POST /api/query-understanding`, defensive JSON parsing with
  full fallback to literal search on any failure. Live-verified: a clear query ("CRISPR gene
  editing") classified as keyword mode; a conceptual query correctly rewritten and classified
  as semantic mode; a genuinely ambiguous input ("transformers") correctly triggered a
  clarifying question distinguishing AI models from electrical engineering, and the follow-up
  turn correctly resolved it using the accumulated `priorTurns`.
- **Multi-paper synthesis chat**: `lib/ai/synthesisContext.ts` reuses the exact embedding-cache
  building blocks semantic search already has. Live-verified with 5 real CRISPR search
  results — the model correctly identified the shared technique (CRISPR-Cas) _and_ correctly
  distinguished each paper's specific contribution (genome-scale knockout screening vs. Cpf1/
  Cas12a vs. multiplexed editing), genuine cross-paper reasoning, not one-at-a-time summarizing.
- **Citation reasoning**: targeted (not bulk) Semantic Scholar abstract lookup, permanent
  `citation_reasoning_cache`. Live-verified both branches: a pair with an unclear relationship
  correctly got an honest "not clearly defined by the abstracts" answer rather than a
  fabricated one; cache-hit confirmed on repeat.
- **Discovered and fixed a real bug during live verification**: LLM `complete()` calls (both
  Anthropic and OpenRouter) used the generic 6s resilience timeout tuned for metadata-fetch API
  calls — too short for real completion latency even under healthy (non-degraded) conditions,
  confirmed by a direct call to the same model succeeding outside the app's timeout window.
  Raised to 30s for both backends, matching what streaming calls already used.
- 49 new tests (251 total, up from 202 at the end of Milestone 2), clean typecheck/lint/
  production build throughout. Full documentation pass: `ARCHITECTURE.md`
  (new "AI-native features (Milestone 3)" section), `SETUP.md`/`.env.example` (OpenRouter vars,
  new curl examples), `KNOWN_LIMITATIONS.md` (7 new entries), `ROADMAP.md` (Milestone 3 marked
  shipped, deferred items given their own "needs its own foundation-design pass first"
  section rather than being silently dropped), `CHANGELOG.md` (`0.3.0`), `README.md`,
  `package.json` version bump.
- Nothing has been committed to git — same standing note as every prior session; commits only
  on explicit request.
- Next: nothing assigned. Documented near-term items (Playwright coverage, streaming search,
  Redis-backed shared cache, DB-side ANN search) and mid-term foundational items
  (accounts/auth, full-text/PDF ingestion, autonomous agents) are not started.

## 2026-07-27 — Milestone 2: AI-Native Features, shipped

- User asked to move ahead with Milestone 2. ROADMAP.md's mid-term AI phase bundles four
  distinct features; asked (AskUserQuestion) whether to scope down to one or build all four —
  user chose all four together, plus "hosted API with local fallback" for the embedding
  backend specifically.
- Ran a dedicated architecture-review pass (Plan subagent) before building. It surfaced one
  real correctness bug in the proposed design (embedding cache keyed by `workKey` alone would
  silently compare vectors from two different, non-comparable embedding models if the active
  backend ever changed between requests — fixed by keying on `(workKey, embeddingModelId)`
  instead) plus several schema/scope refinements (abstract-similarity collision guard instead
  of a title-similarity one, since title is already guaranteed identical by construction of a
  hash-based workKey; per-source citation cache with a TTL; two different Anthropic models for
  two different jobs).
- **Stable work identity**: `CanonicalWork.workKey` (DOI or content-hash, both hashed to a
  uniform token), computed once in `reconcileCluster()`. Finally wired up the `work` table
  (defined since Milestone 1's first migration, never written to) via a fire-and-forget upsert
  on every search, with an abstract-Jaccard-similarity collision guard.
- **Semantic search** (`?mode=semantic`): re-ranks the same live multi-provider candidate pool
  by embedding cosine similarity instead of keyword-token overlap — deliberately NOT a
  pre-built index over all of scholarship (infeasible for a small app). Embedding backend
  auto-detects `OPENAI_API_KEY`, falls back to a local `@xenova/transformers` model
  requiring no key. Live-verified both paths: the local model correctly downloaded, cached,
  and produced 384-dim vectors; a live semantic query demonstrably re-ranked results
  differently from keyword mode while still surfacing genuinely relevant papers; a repeat
  query hit the search cache instantly; a mostly-new query's ~90 uncached candidates took
  tens of seconds to embed locally (documented as an accepted, real cost of the no-API-key
  path in `KNOWN_LIMITATIONS.md`).
- **AI summaries**: Anthropic `claude-haiku-4-5-20251001`, cached, `POST
/api/works/[workKey]/summary`. Live-verified graceful `503` behavior without
  `ANTHROPIC_API_KEY` (not set in this environment).
- **Citation-graph enrichment**: OpenCitations by-DOI (COCI API) merged with a new Semantic
  Scholar citation-detail extension, `GET /api/works/[workKey]/citations`. Live-verified with
  a real, well-known CRISPR paper's DOI — correctly returned real foundational citations
  (Jinek et al. 2012/2013) and real citing papers, with `degraded: true` correctly reported
  when OpenCitations timed out (a real, observed 6s timeout against a heavily-cited paper —
  not a bug) while Semantic Scholar's data still came through.
- **Chat**: Anthropic `claude-sonnet-5`, streaming via `client.messages.stream()`, `POST
/api/chat`, no persistence (client resends full history each turn). Live-verified graceful
  `503` without a key.
- 66 new tests (202 total, up from 136), clean typecheck/lint/production build throughout.
  Full documentation pass: `ARCHITECTURE.md` (new AI-native-features section),
  `SETUP.md`/`.env.example` (new env vars, local-model-download note), `KNOWN_LIMITATIONS.md`
  (9 new entries), `ROADMAP.md` (Milestone 2 marked shipped, new near-term items surfaced by
  this build), `CHANGELOG.md` (`0.2.0`), `README.md`, `package.json` version bump.
- Nothing has been committed to git — same standing note as every prior session; commits
  only on explicit request.
- Next: nothing assigned. Near-term roadmap items (Playwright coverage, streaming search
  results, Redis-backed shared cache, DB-side ANN search over the embedding corpus, a
  graph-edge citation schema) are documented but not started.

## 2026-07-26 (cont. 2) — Post-release fix: ranking ignored query relevance

- User manual-tested Milestone 1 (dev server, live providers) and reported unrelated results
  mixed into an author-name search. Reproduced with a live search for "Geoffrey Hinton": an
  84,794-citation optimizer paper by unrelated authors (Kingma & Ba, "Adam") ranked #1, while
  a paper titled literally "The Architectures of Geoffrey Hinton" was buried at position 36/49.
- Root cause: `scoreWork()` (`lib/merge/rank.ts`) never referenced the query at all — it
  scored purely on log-scaled citations, source agreement, recency, and OA status. Verified
  independently that each provider's own full-text search does its own (loose) relevance
  ranking, but our merge/rank pass discarded that signal entirely and re-sorted by citation
  count alone, letting off-topic-but-highly-cited noise from any single provider's loose
  matching dominate the final result set.
- Fix: added `relevanceScore()` — token overlap between the query and a work's
  title/authors/abstract/venue, weighted higher for title/author matches — as a new dominant
  term in `scoreWork()`. `rankWorks()` now also drops works with zero relevance outright
  rather than merely down-ranking them. Live-verified against both "Geoffrey Hinton" (his own
  papers now rank at top, off-topic high-citation papers no longer appear) and the user's own
  test query "gautam karat" (correctly surfaces the real published author "Gautam Karat" as
  the top 3 exact matches, with same-surname-but-different-person papers appearing lower —
  expected keyword-search behavior, not a bug, since full semantic matching is a mid-term
  roadmap item).
  - Updated `rank.test.ts` with new relevance-specific test cases (zero-overlap exclusion,
    author-match vs. abstract-mention weighting, relevant-but-less-cited beating
    irrelevant-but-highly-cited) and threaded the new required `query` parameter through the
    two existing route tests whose synthetic cache-busting query strings didn't share any
    token with their mocked fixture titles.
  - Updated `ARCHITECTURE.md`'s ranking formula and `KNOWN_LIMITATIONS.md` (new bullet on
    keyword-vs-semantic matching) and `CHANGELOG.md` (`Unreleased` → `Fixed`) accordingly.
  - Full verification: 109/109 tests passing (was 103; added tests), clean typecheck/lint,
    re-verified live against real running dev server and real provider APIs.
- Nothing has been committed to git — same standing note as before, commits only on request.

## 2026-07-26 (cont.) — Documentation finalization, Milestone 1 complete

- Swept all 6 doc files plus `.env.example` for staleness against the finished implementation
  and found (and fixed) two: `ARCHITECTURE.md`'s system diagram and `SETUP.md`/`.env.example`
  still listed OpenCitations among the no-auth fan-out providers, left over from before that
  scope correction. Also updated `ARCHITECTURE.md`'s Frontend/API-contract sections to
  reflect the actual final design (`performSearch()`, cache-then-filter, GET-only).
- Converted `CHANGELOG.md`'s `[Unreleased]` section into a proper `0.1.0` (2026-07-26) release
  entry per Keep a Changelog convention; `package.json` version already matched.
- Replaced the default `create-next-app` boilerplate `README.md` with a real project README
  pointing at the documentation set and a working quick-start.
- Marked Milestone 1 complete in `ROADMAP.md`.
- Added a `KNOWN_LIMITATIONS.md` entry disclosing the lack of browser-based e2e coverage
  (no browser-automation tool was available in this environment) so that gap is a documented
  decision, not a silent one.
- **Milestone 1 status: complete.** All 14 planned build steps done: scaffold, DB layer,
  resilience layer, 9 provider adapters (OpenAlex, Crossref, arXiv, Europe PMC, DOAJ,
  Semantic Scholar, CORE, Unpaywall, PubMed) each verified against their real live APIs,
  dedup/merge, ranking, provider health endpoint with DB persistence, DB-backed search
  cache, full frontend, finalized API contract, logging, and this documentation pass.
  103 automated tests, clean typecheck/lint/production build. Nothing has been committed to
  git yet (only staged, from an early corrected mistake) — commits happen only when asked.
- Next: hand off for review; AI-native features (semantic search, summarization) are the
  next real milestone per `ROADMAP.md`, not started.

## 2026-07-26 (cont.) — Logging pass

- Audited the codebase for stray `console.*` calls: pino (via `logger`/`providerLogger`,
  `lib/log/logger.ts`) was already used consistently throughout the resilience layer,
  orchestrator, search pipeline, and cache persistence from when each was originally built.
  The only `console.*` usage found is in `lib/db/migrate.ts`, a standalone CLI script
  (`pnpm db:migrate`) read directly by a human at a terminal, not part of the running
  server — added a comment explaining this is a deliberate exception, not an oversight.
  No `debugger` statements or `TODO`/`FIXME` markers found either.
- Full suite (103 tests), typecheck, and lint all still green.
- Next: final documentation pass to close out Milestone 1.

## 2026-07-26 (cont.) — API contract polish + route tests

- Finalized `/api/search`'s request contract: `page`, `perPage`, `yearFrom`, `yearTo`,
  `openAccessOnly`, `minCitations`, `sources` are now real, parsed, applied filters — not
  just typed-but-unused fields. GET-only by deliberate choice (documented in
  `ARCHITECTURE.md`): every param is a simple filter, and GET keeps results bookmarkable/
  shareable/cacheable, which a POST body would give up for no benefit here.
- **Redesigned the cache key while wiring this up** — worth calling out as a real
  improvement, not just a mechanical change: the cache now keys on query text only, storing
  the full merged+ranked (unfiltered, unpaginated) result set; `lib/merge/filter.ts`
  (`filterWorks()`) and pagination are applied fresh on every call. Previously the cache key
  would have needed to include every filter/page combination, multiplying cache entries per
  query. Live-verified: searching then re-searching the same query with different filters
  returned `cached: true` — the filtered request reused the cached fan-out rather than
  re-running it, and the returned subset was correctly and fully filtered.
- Extracted the duplicated filter-matching logic that existed in both the (then-unused)
  server-side plan and the frontend's `components/search/filters.ts` into the one shared
  `filterWorks()` function, used by both the API route and the client-side filter sidebar,
  so the two can never define "matches these filters" differently.
- Added 16 new tests: `lib/merge/filter.test.ts` (pure filter logic) and
  `app/api/search/route.test.ts` (full route integration — 400 on missing/blank query, 200
  with `degraded: true` on partial and total provider failure, filter/pagination correctness,
  cache-hit behavior) — 103 tests total, all passing.
- Live-verified against real APIs: unfiltered vs. `openAccessOnly=true&minCitations=1000`
  on the same query — correct `totalEstimate` narrowing, every returned result genuinely
  satisfying both filters, and the second request served from cache as designed above.
- Next: logging pass (remove any stray `console.log`, confirm pino coverage is complete),
  then final documentation pass.

## 2026-07-26 (cont.) — Frontend search UI

- Extracted `/api/search`'s cache/fan-out/merge/rank logic into `lib/search.ts`
  (`performSearch()`), shared by the route handler and the new Server Component page —
  avoids a self-fetch network hop for the initial SSR render and avoids duplicating logic.
- Design simplification worth noting: a new search query is a real Next.js navigation
  (`?q=...`), so the Server Component re-renders with fresh SSR data — no client-side fetch
  needed for that. Filters (year range, open-access-only, min citations, source checkboxes)
  are applied client-side over the already-fetched result set (`components/search/filters.ts`)
  — instant, no loading state needed, and honest/functional rather than a fake control wired
  to nothing. Backend-side filter pushdown (for correctness at larger result-set scale) is
  deferred to task 12's API contract polish.
- Built components: `SearchBar` (client, navigates via `router.push`), `SearchExperience`
  (client, owns filter state + renders the right one of: all-sources-down / no-results /
  filtered-to-nothing / result list), `FilterSidebar` (native form controls throughout),
  `ResultList`/`ResultCard` (semantic `<article>`, `aria-live` result count), `SourceBadge`,
  `DegradedBanner`, `EmptyState` (three distinct variants — never conflating "zero results
  for this query" with "all sources are down" or "your filters excluded everything").
  `app/loading.tsx` for the SSR navigation loading state, respecting `prefers-reduced-motion`.
  `generateMetadata` sets a dynamic title/description/canonical URL per query.
- **Testing disclosure:** no browser-automation tool was available in this environment, so
  interactivity (client-side filtering, search
  navigation) was not verified in an actual browser — only the logic itself, which is
  covered by existing unit tests where it lives outside components. What _was_ verified:
  fetched the real SSR HTML output via `curl` against the dev server for both the empty
  homepage and a live `?q=crispr` search, and confirmed: correct `<title>`, exactly 99
  `<article>` result cards matching the "Showing 99 of 99 results" count, the degraded
  banner correctly naming the actual providers that were down at that moment (arXiv,
  Semantic Scholar, Unpaywall — real live failures, not simulated), 33 real Open Access PDF
  links, and all 4 filter fieldsets with all 9 provider checkboxes present. This confirms
  correct server-rendered output and data wiring, not client-side interactivity.
- Next: API contract polish (filters/pagination in the request, full route-level tests).

## 2026-07-26 (cont.) — DB-backed search-result cache

- Added `lib/cache/searchResultCache.ts`: read-through/write-through cache for the final
  merged+ranked `SearchResponse`, in front of the durable `search_cache` Postgres table.
  Cache key is a SHA-256 hash of the normalized query + filters (filters plumbing ready for
  task 12's full request contract, currently always `{}`). DB writes are fire-and-forget,
  same never-break-the-request contract as the health-snapshot persistence.
  - Degraded responses get a shorter TTL (2 min vs. 15 min) so a recovering provider shows
    up again sooner rather than serving a known-incomplete result for the full window.
  - Removed a small duplicated `ProviderStatusEntry` interface from `db/schema.ts` in favor
    of reusing the one already defined in `lib/types/search.ts`.
- Live-verified the full 3-tier behavior: (1) first request — real 8s fan-out, `cached:
false`; (2) repeated request, same process — 30ms, `cached: true`, served from the
  in-memory LRU; (3) killed and restarted the dev server (empty in-memory cache) and
  repeated the same query again — 0.5s, `cached: true`, proving it came from the Postgres
  read-through rather than a live fan-out (which took 8s a moment earlier). Confirmed the
  row in `search_cache` via `psql` matches the served result count.
- Next: frontend search UI (SearchBar, ResultList/ResultCard, FilterSidebar, loading/error
  states, SSR initial page).

## 2026-07-26 (cont.) — Provider health endpoint + DB persistence

- Refactored `src/lib/db/client.ts` from an eager module-level connection to a lazy `getDb()`
  getter — needed so the resilience layer (imported by essentially every test in the suite)
  never triggers a real DB connection attempt just by being imported, only when a health
  snapshot write actually happens.
- Added `persistHealthSnapshot()`: fire-and-forget write to `provider_health_snapshot` on
  every `withResilience` outcome (success/error/skipped), wrapped so a DB failure (or no
  `DATABASE_URL` at all, as in tests) can never affect the search request that triggered it —
  same "never let one failure break the whole thing" contract as the rest of the app.
- Added `GET /api/health/providers`: merges registry metadata (displayName, requiresCredential)
  with live in-memory health state for every registered provider, including ones never yet
  called (defaults to "up"/"disabled" based on `isConfigured()`). Verified it exposes no
  credential values (only derived booleans).
- Live-verified end-to-end: hit the endpoint before any search (all defaults correct, CORE
  correctly "disabled"), ran a real search, re-hit the endpoint and saw live state reflecting
  the actual call outcomes (including the real Semantic Scholar 429 and Unpaywall 500 from
  the previous session), then confirmed matching rows landed in `provider_health_snapshot`
  via `psql` — the fire-and-forget persistence path works against the real database, not
  just in unit tests.
- Next: DB-backed search-result cache as a durable layer behind the in-memory LRU.

## 2026-07-26 (cont.) — Keyed providers: Semantic Scholar, CORE, Unpaywall, PubMed

- Implemented the 4 remaining Milestone 1 providers, all with credential-based graceful
  degradation: Semantic Scholar (optional API key, works unauthenticated), CORE (requires
  `CORE_API_KEY`), Unpaywall (requires `UNPAYWALL_EMAIL`), PubMed/NCBI (requires `NCBI_EMAIL`,
  optional `NCBI_API_KEY`). PubMed required 3 chained E-utilities calls (ESearch for IDs, then
  ESummary + EFetch in parallel for metadata + abstracts, the latter parsed via
  `fast-xml-parser` like the arXiv adapter) — given a longer default timeout (10s) to match.
  19 new unit tests across the 4 adapters, including both configured/not-configured branches.
- All 9 registered providers (10 minus OpenCitations) now wired into the registry.
- Live-verified against real APIs with the user's own email as the Unpaywall/NCBI contact
  address (a non-secret identifying field their APIs require, not a credential):
  - Baseline (no keyed credentials): confirmed exactly the 6 always-available providers
    participate; CORE/Unpaywall/PubMed correctly absent.
  - With `UNPAYWALL_EMAIL`/`NCBI_EMAIL` set: both correctly activated (`providerCount: 8`,
    only CORE still excluded, matching having no `CORE_API_KEY`).
  - Hit two genuine real-world provider failures during this check — Semantic Scholar's
    unauthenticated pool returned `429` (expected: this is exactly what the optional API key
    exists to relieve), and Unpaywall's `/v2/search` endpoint returned a consistent `500`
    (reproduced independently via plain `curl`, confirmed upstream not us — their single-DOI
    lookup endpoint works fine). Both cases: the app degraded gracefully (`degraded: true`,
    that provider's status reflects the real failure, everything else still returned
    results) rather than crashing or hanging — the resilience layer worked exactly as
    designed against real, unplanned failures, not just simulated ones.
- Next: provider health endpoint (`/api/health/providers`) + DB-persisted health snapshots.

## 2026-07-26 (cont.) — Dedup/merge and ranking

- Built `lib/merge/`: DOI/title/author normalization, a hand-rolled Jaro-Winkler similarity
  function (owned directly rather than pulled in as a dependency, since it's core dedup
  logic), and a union-find-based clustering matcher (DOI-exact first, then fuzzy fallback
  for DOI-less works bucketed by author+year, conservative 0.92 title-similarity threshold).
  Reconciliation picks the best value per field across a matched cluster (published-source
  title/venue preference over arXiv, Crossref-wins DOI conflicts, max citation count,
  ORCID-richest author list, Unpaywall-preferred PDF link). 27 unit tests.
- Built `lib/merge/rank.ts`: simple explainable weighted-sum score (log-scaled citations,
  cross-source agreement count, recency decay, open-access boost) plus `rankWorks()` to sort.
  8 unit tests covering monotonicity in each factor.
- Wired both into `/api/search`: raw provider results -> dedup/merge -> rank -> response.
- Live-verified against real APIs: OpenAlex+Crossref records for the same DOI correctly
  collapsed into one result; result ordering visibly tracks citation count/recency/source
  count. Also observed (and left as an accepted data-quality quirk, not a bug) that some
  providers occasionally register distinct DOIs under an identical title — our conservative
  DOI-exact-trumps-fuzzy design means we never second-guess a source's own DOI assignment.
  Also observed real, fairly high external API latency in this sandbox (up to ~19s on a bad
  run) that occasionally trips all providers into timeout simultaneously — confirmed this
  degrades gracefully (HTTP 200, `degraded: true`, empty results) rather than erroring.
- Next: the 4 keyed providers (Semantic Scholar, CORE, Unpaywall, PubMed) with
  credential-based graceful degradation.

## 2026-07-26 (cont.) — DB layer, resilience layer, and five no-key provider adapters

- Stood up Postgres 16 + pgvector locally via Docker (`pgvector/pgvector:pg16`), added
  Drizzle ORM + `postgres` driver + `drizzle-kit`, wrote the 3-table Milestone 1 schema
  (`search_cache`, `provider_health_snapshot`, `work`), and ran the first migration
  (extension-enable migration followed by the schema migration) — verified via `psql`.
- Built the resilience layer (`src/lib/resilience/`): in-process LRU cache behind a
  swappable `CacheBackend` interface, a 3-state circuit breaker (closed/open/half_open) with
  exponential cooldown, exponential backoff+jitter retry, and `withResilience()` tying them
  together with structured pino logging. 18 unit tests, including fake-timer-driven breaker
  state-transition tests.
  - Learned: `lru-cache` captures a reference to the real `performance` object at
    module-load time, so faking `performance.now()` via vitest after the fact doesn't reach
    its internal TTL bookkeeping — switched that test file to short real timers instead.
  - Learned: a wrapped call only "times out" if it actually observes its `AbortSignal` (like
    `fetch` does) — a promise that never resolves and never checks the signal will hang
    forever regardless of the timeout firing. Added a typed `ProviderTimeoutError` thrown by
    `withResilience` so callers (the orchestrator) can detect timeouts reliably instead of
    string-matching error messages.
- Implemented the provider adapter contract, registry, and orchestrator (`fanOutSearch`),
  plus a bare `/api/search` route returning raw unmerged results (dedup/rank land next).
- Implemented and tested 5 no-key provider adapters end-to-end against their real live APIs:
  OpenAlex, Crossref, arXiv (Atom XML via `fast-xml-parser`), Europe PMC, DOAJ.
  - **Scope correction:** OpenCitations does not offer a keyword-search API — only
    identifier-based citation-graph lookups (COCI/Meta) — so it cannot participate in the
    search fan-out like the other nine sources. Rather than fake that capability, moved it to
    the mid-term citation-graph-aware features phase in `ROADMAP.md`/`KNOWN_LIMITATIONS.md`.
  - Live end-to-end check against all 5 real APIs returned 100 works, `degraded: false`.
  - Also caught and corrected an inaccurate `KNOWN_LIMITATIONS.md` claim: worst-case search
    latency isn't "one timeout's worth" (~6-8s) — with 2 retries it's closer to 3× the
    per-provider timeout plus backoff, confirmed against the live arXiv API (~17s response).
- Next: dedup/merge (`lib/merge/`), then ranking, then the 4 keyed providers (Semantic
  Scholar, CORE, Unpaywall, PubMed) with graceful degradation.

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
