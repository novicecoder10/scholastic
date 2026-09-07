# Quick-win tools: cite, find topics, paraphrase (sub-project #4) — Design

## Context

Sub-project **4 of 9** (see `ROADMAP.md`). Three small, mutually independent
tools batched into one spec because none of them is large enough to warrant
its own, and none depends on the others. The only thing they share is
infrastructure that already exists: the provider/merge layer for citations,
the LLM layer for the other two.

#4 does not depend on #2 or #3. It is sequenced after them because the reader
gives two of the three tools a natural home, but the citation generator and
find-topics are useful against plain search results with no PDF involved.

### Decisions taken before design (2026-09-06)

1. **Citation data** — extend the provider mappers and format deterministically.
   Not "format from what exists and accept gaps", and not an on-demand Crossref
   fetch.
2. **Placement** — in-context, at the surface where each tool is useful. No
   `/tools` hub, no standalone pages.
3. **Paraphraser** — scoped to clarity rewriting with attribution preserved,
   not a general-purpose rewriter and not dropped.

## Goals

- Generate correct, reproducible citations in four styles plus two export
  formats, from data the app already retrieves.
- Give a user a way to see the topical structure of a result set and narrow by
  it.
- Provide a rewriting tool that improves the user's own prose without
  functioning as a plagiarism or detection-evasion aid.
- Add no new external dependency heavier than the feature justifies.

## Non-goals

- No `/tools` hub and no standalone tool pages.
- No citation style beyond APA, MLA, Chicago, BibTeX and RIS. Adding a fifth
  is a new formatter file, deliberately cheap.
- No citation *management* — no saved bibliographies, no folders. That is #5.
- No AI detector, and no positioning of the paraphraser as one's counterpart.
  `ROADMAP.md` already refuses the detector on honesty grounds; a rewriter sold
  as its evasion tool is the same refusal from the other side.
- No changes to search ranking or the fan-out.

---

## 4a. Citation generator

Deterministic end to end. No LLM anywhere in this tool. Citations are the one
output in this product that must never be *plausibly* wrong, and a model that
invents a page range when it lacks one is worse than a citation that admits a
gap.

### The data problem

`CanonicalWork` carries title, authors, year, venue, DOI, and links. It has no
volume, issue, page range, publisher, or work type. APA and Chicago need those
for journal articles, which is the most common case. Crossref, OpenAlex,
PubMed and Europe PMC all return them; the mappers discard them.

### Data layer changes

`RawWork` gains one optional field:

```ts
export interface BibliographicDetail {
  volume: string | null;
  issue: string | null;
  firstPage: string | null;
  lastPage: string | null;
  publisher: string | null;
  containerTitle: string | null;   // journal or book title, as the source states it
  type: string | null;             // journal-article | book-chapter | preprint | ...
  issued: { year: number; month?: number; day?: number } | null;
  issn: string | null;
  isbn: string | null;
}

export interface RawWork {
  // ...existing fields unchanged...
  bibliographic?: BibliographicDetail;
}
```

Optional and additive: arXiv, DOAJ, CORE, Unpaywall and Semantic Scholar
adapters need **no change at all**. Crossref, OpenAlex, PubMed and Europe PMC
populate it.

### Reconciliation: whole-block, not field-by-field

`lib/merge/reconcile.ts` currently picks each canonical field independently —
longest abstract, most-ORCID-bearing author list, modal year. That is right for
those fields and **wrong** for bibliographic detail.

A citation assembled from OpenAlex's volume, PubMed's page range and Crossref's
issue looks authoritative and can be wrong in a way the user cannot detect. So
a new pure function:

```ts
function pickBibliographic(cluster: RawWork[]): BibliographicDetail | null;
```

selects the block **whole**, from the single highest-priority source in the
cluster that has one, using the existing `PUBLISHED_SOURCE_PRIORITY` ranking.
No merging across sources. If no source in the cluster carries one, the result
is `null` and the citation is marked incomplete rather than partially filled.

`CanonicalWork` gains `bibliographic: BibliographicDetail | null`.

### Formatting

```
lib/citations/
  csl.ts               CanonicalWork → CSL-JSON
  format/apa.ts        (work) => string
  format/mla.ts
  format/chicago.ts
  format/bibtex.ts
  format/ris.ts
  index.ts             style registry + completeness check
```

CSL-JSON as the intermediate representation is the load-bearing choice: it is
the interchange format every reference manager understands, it makes BibTeX and
RIS export nearly free, and #8's auto-citation consumes it directly rather than
reimplementing the mapping.

**Why not citeproc-js.** It is the correct answer for arbitrary styles, but it
requires style XML plus a locale bundle — hundreds of kilobytes of runtime and
an asset-loading problem — to support four styles. Each hand-written formatter
is roughly forty lines, is a pure function, and lets us own the edge cases
deliberately: missing author, missing year rendering as `n.d.`, APA's
twenty-one-author ellipsis rule, corporate authors with no given name,
preprints that have no volume by definition.

### Completeness is surfaced, not hidden

`index.ts` exposes a per-style completeness check: which fields the style needs
and which of them are absent. When something required is missing the UI renders
the citation it can produce **plus** an explicit note — "incomplete: no volume
or page range found for this record" — rather than emitting a malformed string
that reads as finished.

### UI

A `Cite` button on `ResultCard`, and the same control in the reader header for
an uploaded document that has a resolvable DOI. It opens a popover with style
tabs, the rendered citation, a copy button, and the completeness note when one
applies. No page, no route.

---

## 4b. Find topics

### What it does

Given the current result set, show its topical structure — the subfields,
methods and recurring concepts across the results — and let the user narrow by
one.

### Hybrid, not pure LLM

OpenAlex returns per-work concepts in the payload the mapper currently drops.
So:

1. `RawWork` gains `topics?: Array<{ name: string; score: number }>`, populated
   by the OpenAlex mapper only.
2. Aggregate them frequency-ranked across the result set. Deterministic, free,
   no model.
3. **One** LLM call clusters and labels the ranked list into five to eight
   human-readable themes, each with a one-line description, grounded strictly
   in the aggregated candidates. The prompt forbids introducing a theme not
   supported by the list — this is a labelling task, not a generation task.

With no LLM configured, step 3 is skipped and the raw ranked concepts are shown
unlabelled. Less polished, still useful, no error state. The same degradation
contract as everywhere else in the app.

### It has to do something

A topic list that only displays is a decoration. Clicking a theme **applies it
to the existing `FilterSidebar` filters**, narrowing the result list in place.
That is the whole point of the tool.

### Placement

A quick action in the homepage task box, alongside the existing ones, and a
collapsible section above the results — the same disclosure pattern
`ChatPanel` already establishes, so it costs no new interaction vocabulary.

---

## 4c. Paraphraser

### A correction to the initial framing

The option chosen was "clarity rewriting of the user's own draft". Working
through placement showed that this is **incompatible** with putting a rewrite
action on text selected in the reader: the text selected in the reader is
someone else's paper. A rewrite button there is exactly the use the framing was
meant to exclude.

The two split cleanly by whose text it is:

| Whose text | Action | Where it goes |
| --- | --- | --- |
| The paper's | **Explain this passage** | Selecting in the PDF routes the passage to the existing chat |
| The user's own | **Rewrite for clarity** | A pasted-text panel; later, #8's editor |

Explaining someone else's writing and rewriting your own are different verbs,
and the surface should say which one it is. This is also the better product:
"explain this dense paragraph" is what a reader actually wants while reading.

### API

`POST /api/paraphrase`, streaming plain text over the same `ReadableStream`
machinery `/api/chat` uses.

```ts
{ text: string; mode: "plain-language" | "concise" | "formal" }
```

Input capped at roughly 2000 words; over that is a 400 naming the limit. No LLM
configured is a 503, matching every other AI endpoint.

### Prompt constraints

Three, and they are correctness requirements rather than style preferences:

- **Citation markers are preserved verbatim.** A rewrite that drops `(Smith
  2019)` silently destroys attribution.
- **No claims are added.** The rewrite may not introduce specifics the source
  text did not contain.
- **Hedging is preserved.** Turning "may suggest" into "shows" is a factual
  error in academic prose, not a tightening. This is the failure mode a
  general-purpose rewriter most reliably produces and the prompt must name it
  explicitly.

### UI

A third tab in the reader's right-hand pane, taking pasted text. The result
panel states that paraphrased source material still requires a citation.

### Stated non-goal

Not positioned, prompted, or documented as a way to obscure authorship or evade
AI detection. `ROADMAP.md` already declines to build the AI detector because
its accuracy claims are not honestly supportable; shipping its evasion
counterpart would be the same problem viewed from the other side.

---

## Testing

vitest, node environment. Everything of consequence in this sub-project is a
pure function, so coverage is genuinely good here — unlike #3.

| Test | Covers |
| --- | --- |
| `format/*.test.ts` | Golden output per style across the cases that actually break formatters: no author, no year (`n.d.`), one author, two authors, twenty-one authors (APA ellipsis), corporate author, no DOI, preprint with no volume, book chapter |
| `csl.test.ts` | `CanonicalWork` → CSL-JSON mapping, including a fully-null `bibliographic` |
| `completeness.test.ts` | Per-style required-field checks; the note text for each missing combination |
| `pickBibliographic.test.ts` | Whole-block selection; priority ordering; two sources both carrying a block; no source carrying one |
| `topics.test.ts` | Frequency aggregation, ranking, tie-break stability, empty result set, results with no OpenAlex member |
| `paraphrase route.test.ts` | Mode validation, the word cap, 503 without an LLM, streaming shape |

### Regression guard

`lib/merge/` is core, load-bearing, well-tested code and this is the first
sub-project to touch it. The guard is simple and should be treated as a hard
rule: **the existing merge, reconcile, matcher, rank and filter tests must pass
unmodified.** `bibliographic` and `topics` are optional additive fields and
`pickBibliographic` is a new function rather than a change to an existing
picker, so nothing in those tests should need to move. If one of them does need
editing, that is the signal the change grew beyond what this spec authorized —
stop and re-scope rather than updating the test.

## Dependencies

None. No new packages in this sub-project — the formatters are hand-written
precisely so there is nothing to add, and both LLM-touching tools use the
provider layer that already exists.

No new environment variables.
