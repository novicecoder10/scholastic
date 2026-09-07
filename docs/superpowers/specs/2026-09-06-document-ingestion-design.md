# Document ingestion infrastructure (sub-project #2) — Design

## Context

This is sub-project **2 of 9** in the sequence laid out in `ROADMAP.md`
("Product sequence — toward a SciSpace-class surface"). Sub-project #1, the
visual redesign, shipped as v0.4.0 on 2026-09-05.

Scholastic has never seen the full text of a paper. Every one of the nine
provider adapters returns metadata plus, at best, an abstract. Every AI
feature built so far — summaries, semantic ranking, single-paper chat,
multi-paper synthesis — reasons over abstracts alone, and
`KNOWN_LIMITATIONS.md` says so explicitly.

Two later sub-projects need full text and cannot start without it:

- **#3 Chat with PDF** — upload a paper and chat with the paper, not its
  abstract.
- **#7 Extract data** — pull tables and statistics out of a paper.

This spec covers the shared foundation both consume: accept a PDF, store it,
extract its text, chunk it, embed the chunks, and expose a retrieval
function. It is deliberately **not user-facing**. There is no page, no
button, and no upload widget in this sub-project; #3 builds the first UI on
top of it.

### Decisions taken before design (2026-09-06)

Three questions forked the design. All three were answered with the
recommended option:

1. **Storage** — a pluggable blob store with a local-disk default, extracted
   text and metadata in Postgres. Not Postgres-only bytea, and not ephemeral.
2. **Ownership** — capability URL (unguessable document id) plus a signed
   anonymous session cookie. Accounts arrive in #5 and adopt the session's
   documents rather than orphaning them.
3. **Scope** — the full ingestion pipeline through embedding and retrieval,
   so #3 is a thin UI and prompt layer and #7 reuses the same retrieval
   rather than reinventing chunking.

## Goals

- Accept a PDF upload, durably store the original bytes, and extract its text.
- Chunk that text page-aware and embed each chunk into the existing pgvector
  setup, reusing the embedding backends already in `lib/ai/embeddings/`.
- Expose one internal function, `retrieveChunks(documentId, query, topK)`,
  as the sole contract #3 and #7 depend on.
- Keep uploads private to the browser that made them, with a migration path
  to real accounts in #5 that does not orphan existing documents.
- Stay inside the app's existing shapes: pluggable adapters behind an
  interface, graceful degradation over hard failure, node-environment vitest
  coverage on every pure unit.

## Non-goals

- **No UI.** No upload widget, no reader page, no route rendering a document.
  That is #3.
- **No OCR.** A scanned, image-only PDF has no extractable text layer and is
  rejected with a clear 422. Adding OCR is a separate decision with its own
  cost and dependency profile.
- **No formats other than PDF.** No DOCX, no LaTeX source, no HTML.
- **No virus scanning.** Out of scope for a self-hosted research tool; noted
  in `KNOWN_LIMITATIONS.md`.
- **No multi-file upload.** One file per request.
- **No automatic retention or garbage collection.** Explicit `DELETE` only.
  An expiry policy invented before accounts exist would be a guess; #5 is the
  right place to decide it.
- **No changes to search, ranking, or any existing provider.** Nothing in
  `lib/providers/`, `lib/merge/`, or `lib/search.ts` is touched.

## Approaches considered

The genuine architectural fork is *when* the expensive work runs. Embedding a
40-page paper produces roughly 200 chunks; on the local `@xenova/transformers`
backend that is minutes of CPU inference. It cannot happen inside the upload
request.

### A. Fully synchronous

`POST` does store → parse → chunk → embed → respond. One code path, trivial to
test, no state machine.

**Rejected.** A multi-minute POST is not a usable API, and the whole upload
fails whenever the embedding backend is slow or unavailable — coupling a
durable operation to an optional one.

### B. Two-phase with a lazy second phase — **chosen**

Phase 1 is synchronous inside the POST: validate → hash → store bytes →
extract → chunk → insert rows with `status: 'parsed'` and null embeddings →
respond. Target under 3s for a 30-page paper.

Phase 2, `ensureIndexed(documentId)`, embeds any chunk missing a vector for
the currently active model. It is kicked off un-awaited immediately after
phase 1, so the common case is already warm, and it is also called
defensively by `retrieveChunks`, so a document whose background pass died
mid-way repairs itself on first query.

This matches how the codebase already behaves: `withResilience`'s cache,
`persistWorks`'s un-awaited writes, and the stated contract that durable
storage is an accelerator rather than a dependency.

### C. Job table plus a background worker

Durable, observable, survives restarts cleanly.

**Rejected as premature.** It introduces a second runtime to deploy and
monitor for exactly one job type. B's "retrieval repairs what is missing"
already covers the crash case at a fraction of the cost. If a second job type
appears later, C becomes worth revisiting.

## Module boundaries

Each module has one purpose, a stated dependency set, and can be understood
without reading its neighbours.

| Module | Purpose | Depends on |
| --- | --- | --- |
| `lib/storage/blobStore.ts` | The `BlobStore` interface — `put` / `get` / `delete` over opaque keys | nothing |
| `lib/storage/localDisk.ts` | Filesystem implementation rooted at `UPLOAD_DIR` | `node:fs` |
| `lib/storage/index.ts` | `getBlobStore()`, env-selected — same shape as `lib/providers/registry.ts` | the two above |
| `lib/pdf/extract.ts` | `unpdf` wrapper returning `{ pageCount, pages: string[], title? }` | `unpdf` |
| `lib/pdf/chunk.ts` | Pure page-aware chunking with overlap | nothing |
| `lib/documents/repository.ts` | Every DB read and write for the two new tables | drizzle |
| `lib/documents/ingest.ts` | The state machine — phase 1 and `ensureIndexed()` | all of the above |
| `lib/documents/retrieve.ts` | `retrieveChunks(documentId, query, topK)` | ingest, embeddings |
| `lib/documents/session.ts` | Signed anonymous session cookie | `node:crypto` |

`retrieveChunks` is deliberately **not** an HTTP endpoint. Nothing on the
client needs raw chunks; #3 calls it server-side to build a prompt context,
exactly as `buildSynthesisContext` does for multi-paper synthesis today.

The `BlobStore` interface is the reason storage is pluggable: an S3
implementation later is a new file plus one line in `getBlobStore()`, not a
refactor of the ingest pipeline.

```ts
export interface BlobStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<ReadableStream<Uint8Array>>;
  delete(key: string): Promise<void>;
}
```

## Data model

Two new tables in `lib/db/schema.ts`.

```
document
  id               serial primary key
  documentId       text unique not null   -- 24 random bytes, base64url; also the capability token
  ownerSessionId   text not null          -- #5 adds a nullable userId beside this
  filename         text not null          -- display only, never used to build a path
  byteSize         integer not null
  sha256           text not null
  storageKey       text not null          -- opaque key into the BlobStore
  status           text not null          -- parsed | indexing | indexed
  pageCount        integer                -- pages actually parsed, after the 500-page cap
  truncated        boolean not null default false
  title            text                   -- from PDF metadata when present
  createdAt        timestamptz not null
  updatedAt        timestamptz not null

  unique(ownerSessionId, sha256)          -- re-uploading the same paper returns the existing document
  index(ownerSessionId, createdAt)

document_chunk
  id               serial primary key
  documentId       text not null          -- references document.documentId by value
  chunkIndex       integer not null
  pageStart        integer not null
  pageEnd          integer not null
  content          text not null
  embedding        vector(384)            -- null until phase 2 completes
  embeddingModelId text

  unique(documentId, chunkIndex)
  index using hnsw (embedding vector_cosine_ops)
```

`document_chunk.embedding` reuses the existing `EMBEDDING_DIMENSIONS` constant
(384) so a single fixed-width column works for either embedding backend, and
copies `workEmbedding`'s model-id discipline: a chunk embedded under a
different model than the currently active one counts as **not indexed** and is
recomputed. Comparing vectors across model spaces returns plausible-looking
nonsense rather than an error, so this has to be enforced rather than assumed.

`pageStart` / `pageEnd` exist so #3 can cite "page 7" and #7 can point at
where a table came from. A chunk spans a page range because chunking is
page-aware but not page-bounded — a short page merges with its neighbour.

## Ingestion pipeline

### Phase 1 — synchronous, inside `POST /api/documents`

1. Read the multipart body's `file` field.
2. Reject over 30 MB (413).
3. Verify the leading bytes are `%PDF-` (400). The declared `Content-Type` is
   a client claim and is not trusted for this.
4. SHA-256 the bytes. If `(ownerSessionId, sha256)` already exists, return
   that existing document — re-uploading the same paper is idempotent.
5. Generate `documentId` and `storageKey`, both from the same 24 random bytes.
6. `blobStore.put()` the original bytes.
7. `extract()` the text. No text layer at all, or an encrypted document → 422,
   blob deleted, no row written. A rejected upload leaves no trace, which is
   why `document` has no terminal failure status.
8. `chunk()` the pages.
9. Insert the `document` row with `status: 'parsed'` and its chunk rows with
   null embeddings, in one transaction.
10. Fire `ensureIndexed(documentId)` un-awaited.
11. Respond 201.

Page cap: 500. A longer document is parsed to page 500, stored with
`truncated: true`, and flagged in the response, rather than rejected — a 900-page thesis is still useful for
its first 500 pages, and the cap bounds both parse time and embedding cost.

### Phase 2 — `ensureIndexed(documentId)`

Idempotent and concurrency-safe via a per-document in-process promise map, the
same pattern `lib/ai/embeddings/cache.ts` already uses. It selects chunks
whose `embeddingModelId` is not the active model, embeds them in batches,
writes the vectors back, and moves `status` `indexing → indexed`. Any failure
leaves the already-written vectors in place and the status at `parsed`, so
the next call resumes rather than restarting.

### Retrieval

`retrieveChunks(documentId, query, topK)` calls `ensureIndexed` first, embeds
the query with `embedQuery` (the same function semantic search uses), and
ranks by cosine similarity.

If embeddings are unavailable entirely — no hosted key and the local model
fails to load — it falls back to term-overlap scoring over the chunk text.
Worse retrieval, working feature. This is the same graceful-degradation
contract applied everywhere else in the app.

## API surface

| Route | Behavior |
| --- | --- |
| `POST /api/documents` | multipart/form-data, field `file` → 201 `{ documentId, pageCount, chunkCount, truncated, status }` |
| `GET /api/documents` | the current session's documents, newest first |
| `GET /api/documents/[documentId]` | metadata plus `status` — how a client watches `parsed → indexed` |
| `GET /api/documents/[documentId]/file` | streams the original bytes; #3's reader pane needs this |
| `DELETE /api/documents/[documentId]` | deletes chunk rows, the document row, and the blob |

Status codes: **400** not a PDF or no file, **413** over 30 MB, **422**
encrypted or no extractable text, **503** storage unwritable or database
unreachable.

A document the current session does not own returns **404, not 403**. A 403
confirms the id exists, which defeats the point of an unguessable id.

## Ownership and security

A signed cookie, `scholastic_sid`: `httpOnly`, `sameSite=lax`, `secure` in
production, one-year `maxAge`, value `<sessionId>.<hmacSha256(sessionId,
SESSION_SECRET)>`. It is minted on first upload, not on every page view.

`SESSION_SECRET` is a new optional environment variable. When it is unset the
process derives an ephemeral secret at startup and logs a warning: uploads
then stop being reachable after a restart. That is degradation with a clear
signal, matching how every optional credential in this app already behaves,
rather than a hard startup failure.

Other surfaces:

- **Path traversal** — storage keys are derived server-side from the random
  `documentId`. The user-supplied filename is stored for display and never
  used to build a path. `localDisk` additionally rejects any resolved path
  that escapes its root, as defense in depth.
- **Resource exhaustion** — bounded by the 30 MB byte cap and the 500-page
  cap together; neither alone is sufficient against a compressed
  pathological PDF.
- **Enumeration** — 24 random bytes of document id, and 404 for
  non-owned documents.

When #5 introduces accounts, `document` gains a nullable `userId` and sign-up
claims the session's existing documents. Nothing needs to be migrated or
thrown away.

## Degradation contract

One honest exception to a rule this project has held everywhere else.

Every existing feature treats Postgres as an accelerator: the search cache,
work persistence, and the embedding cache all degrade to "recompute it" when
the database is gone. Uploads cannot. There is nowhere else to put the
extracted text and chunk vectors, and pretending otherwise would mean
accepting a file and silently losing it.

So `POST /api/documents` returns a clear 503 when the database is unreachable
— the same shape as `NO_LLM_PROVIDER_MESSAGE` for the LLM-less case — and
this becomes the first entry in a new "Document ingestion (sub-project #2)"
section of `KNOWN_LIMITATIONS.md`.

## Testing

vitest in the node environment only. This repo has no jsdom and no
`@testing-library/react`, and this sub-project ships no components, so
nothing about that changes.

| Test | Covers |
| --- | --- |
| `chunk.test.ts` | Page boundaries, overlap, one giant page, an empty page, a page shorter than the overlap |
| `session.test.ts` | Signature round-trip; a tampered cookie is rejected |
| `localDisk.test.ts` | put/get/delete round-trip in a tmpdir; a key escaping the root is rejected |
| `extract.test.ts` | Three committed fixtures under `src/test/fixtures/pdf/` — normal, encrypted, image-only — pinning both the extracted text and the 422 classifications |
| `ingest.test.ts` | Blob store and embeddings mocked: `parsed → indexed`; an extraction failure persists no row and deletes the blob; a phase-2 failure leaves `status: 'parsed'` so the next call resumes; re-upload of an identical file is idempotent |
| `retrieve.test.ts` | Ranking with stub embeddings; the lexical fallback when `embedQuery` throws |
| Route tests | Each endpoint's status codes, following `src/app/api/search/route.test.ts`'s existing shape |

The three PDF fixtures are generated once and committed, small enough to read
in a diff. They are the only new binary assets.

## Dependencies

One new package: **`unpdf`** (1.8.1) — a maintained repack of pdf.js for
server runtimes. No native bindings, no `canvas`, works under the Next.js
node runtime. `pdfjs-dist` directly would require the same wrapper work by
hand; `pdf-parse` wraps an older pdf.js and pulls in more than is needed.

One new optional environment variable, `SESSION_SECRET`, and one new optional
path variable, `UPLOAD_DIR` (defaulting to `.uploads/` in the project root,
gitignored). Both documented in `.env.example` and `SETUP.md`.

## Housekeeping

`src/lib/pdf/`, `src/lib/collections/`, `src/lib/credits/`, `src/lib/matrix/`,
`src/lib/templates/`, `src/lib/topics/`, `src/lib/venues/`,
`src/lib/authors/`, `src/lib/export/`, `src/lib/graph/`, `src/lib/net/`,
`src/lib/search/`, `src/app/reader/`, `src/app/collections/`,
`src/app/credits/`, `src/app/matrix/`, `src/app/templates/`,
`src/components/pdf/`, `src/components/credits/`, and several sibling API
directories currently exist as **empty directories** — leftover scaffolding
from an earlier session, untracked by git because git does not track empty
directories. This sub-project fills `src/lib/pdf/`. The rest are removed as
part of this work; each later sub-project creates what it actually needs.
