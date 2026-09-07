# Chat with PDF (sub-project #3) — Design

## Context

Sub-project **3 of 9** (see `ROADMAP.md`). It depends entirely on #2, the
document ingestion infrastructure specced in
`2026-09-06-document-ingestion-design.md`, and cannot start before it.

Scholastic already has three chat surfaces, all served by one route
(`/api/chat`) and one component (`ChatPanel`):

- single-paper Q&A, grounded in a title and abstract;
- multi-paper synthesis over the current result set;
- two fixed-prompt variants of that synthesis (agreement/contradiction
  detection, literature-review draft).

Every one of them reasons over **abstracts**. That is the ceiling this
sub-project raises: upload the actual paper and ask questions the abstract
cannot answer — what dataset, what sample size, what the limitations section
concedes.

#2 delivers the ingestion half (store, parse, chunk, embed) and one internal
contract, `retrieveChunks(documentId, query, topK)`. This spec is the UI and
prompt layer over that contract, plus the first user-facing surface #2's
upload endpoint has ever had.

### Decisions taken before design (2026-09-06)

1. **Route shape** — extend the existing `/api/chat` with an optional
   `documentId` rather than adding a dedicated route. The route already
   resolves this exact fork across three context sources with one streaming
   path; document chat is a fourth branch and a prompt.
2. **UI shape** — a split view at `/reader/[documentId]`: rendered PDF on the
   left, chat on the right, with page citations in answers scrolling the PDF.
   Not chat-only, and not bolted onto the transient homepage search state.

## Goals

- Let a user upload a paper and chat with its full text, with answers cited
  back to specific pages.
- Reuse the existing chat machinery — streaming, message validation, error
  handling, `ChatPanel` — rather than duplicating it.
- Give #2's `POST /api/documents` its first real entry point.
- Keep every existing chat mode working unchanged.

## Non-goals

- **No annotation or highlighting.** Reading and asking, not marking up.
- **No text-selection → "ask about this".** A good affordance; not required
  for the feature to work, and it needs selection-coordinate plumbing through
  the PDF renderer.
- **No chat across multiple documents.** That needs #5's library to have a
  notion of a document set.
- **No saved conversations.** Chat remains stateless and client-round-tripped,
  exactly as the existing route documents. Persistence is #5.
- **No OCR.** A scanned PDF is a 422 at upload (#2) and never reaches here.
- **No changes to search, ranking, or the provider layer.**

## Server side

### `/api/chat` gains `documentId`

```ts
interface ChatRequestBody {
  messages: ChatMessage[];
  context?: string;      // single-paper: title + abstract
  works?: SynthesisWork[]; // multi-paper synthesis
  documentId?: string;   // NEW — full-text chat over an uploaded PDF
  mode?: ChatMode;
  rankingQuery?: string;
}
```

`context`, `works`, and `documentId` are **mutually exclusive**. More than one
present is a 400 with a message naming the conflict. Today the route resolves
`works` over `context` implicitly by ordering; making the exclusivity explicit
is a small correctness improvement to existing behavior, made here because
this change is what turns a two-way implicit precedence into a three-way one.

When `documentId` is present the route:

1. Resolves the anonymous session from the signed cookie (#2's
   `lib/documents/session.ts`).
2. Loads the document. Not found, or not owned by this session → **404**.
   Not 403 — a 403 confirms the id exists, which defeats #2's capability
   model.
3. Calls `retrieveChunks(documentId, rankingQuery, TOP_K)`.
4. Formats the hits as page-attributed context blocks:

```
[page 7]
…chunk text…

[page 12]
…chunk text…
```

The formatter is its own pure function in `lib/documents/chatContext.ts`,
mirroring how `buildSynthesisContext` is separate from the route.

### A fourth system prompt

`DOCUMENT_SYSTEM_PROMPT` joins the three already in the route. It instructs
the model to answer only from the supplied excerpts, to cite pages in the
form `[p. 7]`, and to say plainly when the excerpts do not cover the
question — the same anti-fabrication discipline every existing prompt in this
file already carries.

Because retrieval returns excerpts rather than the whole paper, the prompt
must also make the model distinguish "the paper does not say this" from "the
retrieved excerpts do not cover this". Those are different claims and only
the second is defensible.

### Ranking query: a deliberate divergence

The existing route ranks synthesis context against `messages[0]` and explains
why in a comment: the paper set is fixed and the topic is the original search
query, so every turn recomputes an identical top-8 with no extra cost and no
selection state to carry.

**That argument does not transfer to a single document.** "What dataset did
they use?" and "what do they concede in the limitations?" are questions about
different parts of the same paper. Ranking both against the first message
would retrieve the wrong pages for every follow-up.

Document chat therefore ranks against the **latest user message**. This
reasoning goes in a comment directly beside the existing one it appears to
contradict, so a future reader does not "fix" the inconsistency back into a
bug.

## The reader surface

### `/reader/[documentId]`

A Server Component. It loads document metadata server-side and calls
`notFound()` when the session does not own it, so ownership is enforced
before any client JavaScript runs — the 404 is rendered, not fetched.

It renders `ReaderWorkspace`, a client component holding the split view:

```
┌──────────────────────────┬───────────────────────┐
│  PdfPane                 │  ChatPanel            │
│  (react-pdf, scrollable) │  (variant="embedded") │
│                          │                       │
│  page 7  ◄───────────────┼── [p. 7] clicked      │
└──────────────────────────┴───────────────────────┘
```

Below the `sm` breakpoint the two panes become tabs rather than columns; a
side-by-side split is unusable on a phone and the app has been mobile-first
since Milestone 1.

### `/reader`

With no id, the upload page: a drop zone posting to #2's
`POST /api/documents`, plus a list of the session's existing documents from
`GET /api/documents`. This is the first and only user-facing surface #2's
endpoint has.

It surfaces #2's error codes as real messages — 413 over 30 MB, 422 no
extractable text (with an explicit "scanned PDFs aren't supported" line, since
that is the case a user will actually hit), 503 not configured.

`Reader` joins `TopNav` as a real `NavLink`. `Library` stays a `SoonLink`
until #5.

### PDF rendering

**`react-pdf` 10.5.0.** It lists React 19 in its peer range;
`@react-pdf-viewer` is pinned to `pdfjs-dist` v2/v3 and is not a candidate.

- Dynamically imported with `ssr: false` — pdf.js needs canvas and DOM.
- The pdf.js worker is copied into `public/` by a postinstall script rather
  than loaded from a CDN, so the app stays functional offline and introduces
  no third-party origin.
- Pages render lazily around the viewport rather than all at once; a 500-page
  document (#2's cap) must not mount 500 canvases.
- The document is fetched from #2's `GET /api/documents/[id]/file`, which is
  already session-guarded.

### Page citations

Assistant answers contain `[p. 7]`. A pure function turns those into buttons:

```ts
// lib/documents/pageCitations.ts
export function splitPageCitations(text: string):
  Array<{ type: "text"; value: string } | { type: "citation"; page: number }>;
```

`ChatPanel` renders the result, and a citation button calls `onCitePage(7)`,
which scrolls `PdfPane` to that page.

It is a pure string-in / structure-out function specifically so it can be
tested in this repo's node-only vitest, with no jsdom and no renderer.

## Reusing ChatPanel

`ChatPanel`'s own doc comment already states that its streaming-consumption
logic is identical across its two context modes and only the payload differs.
This adds a third mode rather than forking the component:

| New prop | Purpose |
| --- | --- |
| `documentId?: string` | Sent to `/api/chat` instead of `context` / `works` |
| `onCitePage?: (page: number) => void` | Makes `[p. N]` interactive; without it, citations render as plain text |
| `variant?: "disclosure" \| "embedded"` | The reader needs a full-height always-open pane, not a collapsed toggle |

`variant` defaults to `"disclosure"`, so every existing call site is
unchanged.

## States and failure modes

| State | Behavior |
| --- | --- |
| Document still indexing | `retrieveChunks` calls `ensureIndexed` and would block — possibly a minute on the local embedding backend. So the reader polls `GET /api/documents/[id]` and keeps the composer disabled with visible progress until `status: 'indexed'`. Chat is only ever reachable warm. |
| No LLM configured | The existing 503 path and `ChatPanel`'s existing disabled state. Unchanged. |
| Lexical retrieval fallback (#2) | Answers get measurably worse. Surfaced as a quiet notice in the chat header rather than hidden — the user should know why quality dropped. |
| Document deleted mid-session | The next chat turn 404s; the reader shows a "this document is gone" state rather than a stuck spinner. |
| PDF renders but retrieval finds nothing | The model is instructed to say the excerpts do not cover it. Not an error state. |

## Testing

vitest, node environment. Pure logic is covered properly:

| Test | Covers |
| --- | --- |
| `pageCitations.test.ts` | `[p. 7]`, multiple, adjacent, malformed (`[p. ]`, `[p. abc]`), none at all, a citation split across a streaming chunk boundary |
| `chatContext.test.ts` | Chunk → page-attributed block formatting; empty retrieval; a chunk spanning a page range |
| `/api/chat` route tests | `documentId` + `context` together → 400; unowned document → 404; happy path streams with document context; ranking uses the **latest** message, not the first; all three existing modes still behave identically |

### The coverage gap, stated plainly

The split view, the scroll-to-page wiring, and the upload drop zone are the
most valuable parts of this sub-project and will have **no automated
coverage**. This repo has no jsdom, no `@testing-library/react`, and no
Playwright; verification has been manual and screenshot-driven since
Milestone 1.

That was an acceptable trade when the UI was a search form. It stops being
one here: a split-pane reader with a renderer, polling, and cross-pane
interaction is the first surface in this app where the interesting bugs are
all in the parts tests cannot see. Playwright is already listed under
"Near-term" in `ROADMAP.md`. #3 is the point where its absence starts costing
real time, and that should be weighed before #4 rather than after #9.

## Dependencies

- **`react-pdf`** (10.5.0) — the only new runtime dependency, and the only
  one in this sub-project with real weight.
- A postinstall script copying the pdf.js worker into `public/`.

No new environment variables.
