# AI Writer — Design

Date: 2026-09-06
Sub-project: #8 of 9
Depends on: #4 (citation formatters), #5 (accounts and library), #6 (costing),
#7 (uploaded-document titles, for the corpus match)
Status: approved, not implemented

## What this is

A manuscript editor whose citations are live objects rather than typed text,
with a small set of AI operations that assist the writer without writing for
them.

### Decisions taken before design (2026-09-06)

1. **Editor** — Tiptap 3.31.3 (ProseMirror), which supports React 19 and makes
   custom inline nodes first-class. Not Lexical (pre-1.0, more API churn), not
   a markdown textarea (loses the citation UI that justifies the feature).
2. **Generation** — assistive operations plus one grounded drafting mode. No
   freeform prose generation from a bare prompt.
3. **Persistence** — sign-in required. The first feature in the app that
   requires an account.

## Citations are nodes, and labels are never stored

A citation is an inline atom node with exactly one attribute:

```ts
// lib/manuscript/citationNode.ts
Node.create({
  name: "citation",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes: () => ({ workKey: { default: null } }),
});
```

No number. No author-year string. Nothing about how it renders. The label is
derived at render time from document order and the active style.

Everything useful follows from that:

- Reordering paragraphs renumbers automatically.
- Switching APA to MLA is a re-render, not a rewrite.
- Deleting a sentence removes its bibliography entry.
- The same work cited twice produces one entry.

This is the entire reason for choosing ProseMirror over a markdown box, and it
is the load-bearing structural decision in this spec.

## The bibliography is derived, never stored

```ts
// lib/manuscript/bibliography.ts — pure over the doc JSON
export function collectCitedWorkKeys(doc: JSONContent): string[];
export function buildBibliography(
  works: CanonicalWork[],
  style: CitationStyle,
): string[];
```

Walk the document, collect `workKey`s in first-appearance order, dedupe,
resolve each, format through #4's `lib/citations/format/*`. One button, zero
new formatting code.

### Resolution order

1. #5's `saved_item.workSnapshot`. That column exists precisely because
   `persistWorks` is un-awaited best-effort and the `work` row may be stale or
   absent; a manuscript is exactly the consumer that cannot tolerate that.
2. The `work` table.
3. A live provider lookup, cached.

A `workKey` that resolves to nothing renders as a **visible broken-citation
marker**, both inline and as a bibliography line saying so. It is never
silently dropped. A citation that quietly disappears from a manuscript is a
plagiarism risk, not a rendering bug.

## AI operations

All selection-scoped, all streaming into the editor, all reversible through the
editor's own undo stack.

| Operation | Input | Effect |
| --- | --- | --- |
| Rewrite for clarity | selection | Replaces selection. `POST /api/paraphrase` from #4, unchanged. |
| Tighten | selection | Replaces selection. Same endpoint, `concise` mode. |
| Explain | selection | Side-panel explanation, no document mutation. |
| Find support | selection (a claim) | Ranked candidate works; the user picks one, which inserts a citation node. |

### The AI never attaches a citation on its own

Find support shows candidates from the user's library and from live search, and
requires an explicit pick. There is no confidence threshold above which it
auto-inserts.

This is a correctness rule, not a UI default. A wrong citation is worse than no
citation: it looks authoritative, it is rarely re-checked, and it survives into
the published version.

## The one generative mode

**Grounded draft.** Input is a set of works the user selects from a #5
collection. Output is a related-work or synthesis draft streamed into the
document, in which every sentence carries at least one citation node drawn only
from that set.

It reuses `buildSynthesisContext` unchanged, ranking the supplied works against
the section topic exactly as multi-paper synthesis chat already does. No new
retrieval layer.

### Mechanical validation, not prompt hope

After generation and before insertion:

- Any sentence containing no citation is stripped.
- Any citation whose `workKey` is not in the supplied set is stripped.
- If stripping empties the draft, nothing is inserted and the user is told why.

Same guard pattern as #7's non-invention checks: the constraint is enforced in
code, so it holds regardless of what the model returns.

Inserted content is marked AI-drafted in the UI until the user edits it.

### Why this shape, stated plainly

This drafts a literature summary from sources the user chose, with attribution
on every sentence. It is not a ghost-writer for arbitrary academic prose. The
reasoning is the same one on which `ROADMAP.md` refuses to build an AI
detector: a tool that produces unattributed academic text on demand is at odds
with what this project claims to be for.

## Citing an uploaded document

#7 deliberately deferred linking an uploaded PDF to a canonical work. This is
where it lands, because citing an upload requires a bibliography entry and an
upload has no DOI.

The manuscript offers a match against the corpus using `lib/merge/matcher.ts`
over the document's extracted title, presented as a **suggestion the user
confirms**. Same rule as find support: never automatic. An unconfirmed upload
cites as a manual entry the user fills in.

## Data model

```
manuscript
  id, publicId, userId not null references user(id) on delete cascade,
  title, doc jsonb not null, citationStyle text not null,
  createdAt, updatedAt
  index(userId, updatedAt desc)

manuscript_revision
  id, manuscriptId, doc jsonb, createdAt
  index(manuscriptId, createdAt desc)
```

Autosave is debounced on change. Revisions snapshot on a coarser cadence and
are capped as a ring, oldest evicted. An editor that can lose a manuscript is
worse than no editor.

`userId` is `not null` — this is the one place in the app where anonymous
ownership is refused, because a session-scoped manuscript is a data-loss trap
dressed as convenience. Anonymous visitors see `/write` explain what it is,
with a sign-in prompt.

## Export

| Format | How |
| --- | --- |
| Markdown | Body plus a bibliography section, labels per active style |
| BibTeX | #4's formatter over the resolved works |
| RIS | #4's formatter |
| LaTeX | Body with `\cite{key}`, plus a matching `.bib` |

LaTeX is nearly free once BibTeX exists — the same keys serve both.

**`.docx` is deferred, not refused.** It is what most researchers actually
submit, so declaring it out of scope would be dishonest. It needs a new
dependency and its own fidelity work, and the Markdown and LaTeX paths cover
the communities most sensitive to citation correctness. It is the obvious next
addition after this ships.

## Cost

Under #6: rewrite, tighten, explain, find support, and grounded draft are
metered. Typing, citation insertion, style switching, bibliography generation,
and every export are free, because they are deterministic. The grounded draft
shows an estimated cost before running.

## Degradation

With no LLM configured, the editor, citation nodes, bibliography, style
switching, and all four exports work completely. Only the five AI operations
are disabled, with a notice.

That leaves a genuinely usable citation-managing writer with zero AI, which is
a design target rather than an accident.

## UI

- `/write` — the user's manuscripts, newest first. Sign-in gated.
- `/write/[publicId]` — the editor. Toolbar, a citation style selector, an
  AI menu that appears on selection, and a right rail holding the live
  bibliography and the find-support results.
- Inserting from the library: a picker over #5's saved papers and collections.

## Testing

Node-environment vitest over the pure layer, which is where the logic lives:

- `collectCitedWorkKeys`: first-appearance order; duplicates collapse to one
  entry; reordering paragraphs changes order; deleting a node removes it.
- Per-style label generation; switching style changes labels only, never the
  document.
- An unresolvable `workKey` produces a broken marker inline and in the
  bibliography, and is never dropped.
- Draft validator: a sentence with no citation is stripped; a citation outside
  the supplied set is stripped; an emptied draft inserts nothing.
- Export: Markdown bibliography matches the collected keys; LaTeX `\cite` keys
  match the generated `.bib` keys exactly.
- Upload matching returns a suggestion and never mutates the document.

### The gap, stated once

The editor itself cannot be tested in node-only vitest. #3 flagged this, #5
escalated it to "add Playwright before implementing". By the time #8 is built
that recommendation has either been acted on or the writer ships unverified.
No further warning is issued here.

## Non-goals

- Real-time collaborative editing. y.js plus a websocket server is a second
  runtime for one feature.
- Comments and track-changes.
- Full-document generation from a bare prompt.
- Auto-inserting any citation without explicit confirmation.
- Journal submission templates and style-sheet compliance checking.
- Anonymous manuscripts.

## New configuration

Dependencies: `@tiptap/react`, `@tiptap/core`, `@tiptap/pm`,
`@tiptap/starter-kit` (all 3.31.3). No new environment variables.
