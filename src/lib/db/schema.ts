import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  serial,
  bigserial,
  bigint,
  real,
  index,
  uniqueIndex,
  vector,
} from "drizzle-orm/pg-core";
import type { ProviderStatusEntry, SearchResponse } from "@/lib/types/search";

/**
 * Shared by both embedding backends (hosted OpenAI truncated via its `dimensions`
 * param, and the local transformers.js model's native output) so a single
 * fixed-width pgvector column works for either — see `lib/ai/embeddings/`.
 */
export const EMBEDDING_DIMENSIONS = 384;

export interface WorkAuthor {
  name: string;
  orcid?: string;
}

export interface WorkSourceRef {
  sourceId: string;
  sourceRecordId: string;
}

/**
 * Durable complement to the in-memory LRU search cache: survives restarts and
 * cold starts, and doubles as an audit trail of what a query returned historically.
 */
export const searchCache = pgTable(
  "search_cache",
  {
    id: serial("id").primaryKey(),
    queryHash: text("query_hash").notNull().unique(),
    queryText: text("query_text").notNull(),
    filters: jsonb("filters").$type<Record<string, unknown>>(),
    resultPayload: jsonb("result_payload").$type<SearchResponse>().notNull(),
    providerStatuses: jsonb("provider_statuses").$type<ProviderStatusEntry[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("search_cache_expires_idx").on(t.expiresAt)],
);

/**
 * Periodic snapshot of the in-memory provider health store, so
 * /api/health/providers has continuity across restarts and trends are graphable.
 */
export const providerHealthSnapshot = pgTable(
  "provider_health_snapshot",
  {
    id: serial("id").primaryKey(),
    providerId: text("provider_id").notNull(),
    health: text("health").notNull(), // up | degraded | down | disabled
    circuitState: text("circuit_state").notNull(), // closed | open | half_open
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    avgLatencyMs: real("avg_latency_ms"),
    rateLimitRemaining: integer("rate_limit_remaining"),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("provider_health_provider_idx").on(t.providerId, t.recordedAt)],
);

/**
 * Canonical merged work records. Not required for a single search request/response
 * cycle, but persisted so future milestones (embeddings, saved searches) have a
 * stable id to reference without a disruptive migration.
 */
export const work = pgTable(
  "work",
  {
    id: serial("id").primaryKey(),
    /**
     * Stable identity across requests — see `lib/ai/workKey.ts`. The single
     * upsert conflict target for both DOI and DOI-less works (not two separate
     * upsert paths). `doi` remains its own unique column for direct lookups.
     */
    workKey: text("work_key").notNull().unique(),
    doi: text("doi").unique(),
    title: text("title").notNull(),
    abstract: text("abstract"),
    year: integer("year"),
    venue: text("venue"),
    authors: jsonb("authors").$type<WorkAuthor[]>().notNull(),
    citationCount: integer("citation_count"),
    isOpenAccess: boolean("is_open_access").default(false),
    pdfUrl: text("pdf_url"),
    landingPageUrl: text("landing_page_url"),
    sources: jsonb("sources").$type<WorkSourceRef[]>().notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("work_title_idx").on(t.title), index("work_year_idx").on(t.year)],
);

/**
 * Cross-query embedding compute cache (not a pre-built searchable index — see
 * ARCHITECTURE.md's semantic search section). Keyed by (workKey, embeddingModelId)
 * rather than workKey alone: a cache hit under a different model than the one
 * currently active would silently compare non-comparable vector spaces, so a
 * model mismatch must be treated as a cache miss and recomputed.
 */
export const workEmbedding = pgTable(
  "work_embedding",
  {
    id: serial("id").primaryKey(),
    workKey: text("work_key").notNull(),
    embeddingModelId: text("embedding_model_id").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("work_embedding_key_model_idx").on(t.workKey, t.embeddingModelId),
    // Not queried via ANN in v1 (candidate similarity is scored in-process per
    // request), but enabled now — cheap today, avoids a disruptive migration if
    // a DB-side ANN search over the accumulated corpus becomes useful later.
    index("work_embedding_vector_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

/** Read-through cache in front of the Anthropic summary call, keyed by workKey. */
export const workAiSummary = pgTable(
  "work_ai_summary",
  {
    id: serial("id").primaryKey(),
    workKey: text("work_key").notNull().unique(),
    summary: text("summary").notNull(),
    model: text("model").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("work_ai_summary_key_idx").on(t.workKey)],
);

/**
 * Read-through cache for citation-graph enrichment (OpenCitations by-DOI,
 * Semantic Scholar citation details). No graph-edge schema for v1 — there's no
 * product surface yet that needs graph traversal, just per-work enrichment.
 * Citation data changes over time (unlike an abstract), so callers apply a TTL
 * against `fetchedAt` rather than treating a hit as permanent.
 */
export const citationCache = pgTable(
  "citation_cache",
  {
    id: serial("id").primaryKey(),
    workKey: text("work_key").notNull(),
    source: text("source").notNull(), // "opencitations" | "semantic_scholar"
    payload: jsonb("payload").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("citation_cache_key_source_idx").on(t.workKey, t.source)],
);

/**
 * Read-through cache for a specific citation-pair's LLM-generated relationship
 * explanation ("who built on whom, and why"). Permanent (no TTL) — mirrors
 * `workAiSummary`'s shape, not `citationCache`'s 1-week TTL, since a specific
 * pair's abstracts and the LLM's characterization of their relationship don't
 * change the way a citation *list* does. Keyed by the normalized
 * (citingDoi, citedDoi) pair regardless of which paper was "root" when asked —
 * the same edge viewed from either paper's citation graph hits the same row.
 */
export const citationReasoningCache = pgTable(
  "citation_reasoning_cache",
  {
    id: serial("id").primaryKey(),
    citingDoi: text("citing_doi").notNull(),
    citedDoi: text("cited_doi").notNull(),
    reasoning: text("reasoning").notNull(),
    model: text("model").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("citation_reasoning_pair_idx").on(t.citingDoi, t.citedDoi)],
);

/**
 * An uploaded PDF. `documentId` is the capability token: 24 random bytes,
 * base64url — unguessable, and the sole thing needed to read the document.
 * `ownerSessionId` scopes it to the browser that uploaded it; #5 adds a
 * nullable `userId` beside it and adopts these rows on sign-in rather than
 * orphaning them.
 *
 * There is deliberately no terminal failure status. A rejected upload
 * persists no row at all (and its blob is deleted), and a phase-2 embedding
 * failure leaves the row at `parsed` so the next call resumes it.
 */
export const document = pgTable(
  "document",
  {
    id: serial("id").primaryKey(),
    documentId: text("document_id").notNull().unique(),
    ownerSessionId: text("owner_session_id").notNull(),
    /** Set on sign-in adoption (#5). A row is owned by its userId when that is
     * set, and by its ownerSessionId otherwise — never by both at once for the
     * purposes of a lookup. See lib/auth/owner.ts. */
    userId: text("user_id"),
    filename: text("filename").notNull(),
    byteSize: integer("byte_size").notNull(),
    sha256: text("sha256").notNull(),
    storageKey: text("storage_key").notNull(),
    /** parsed | indexing | indexed */
    status: text("status").notNull(),
    /** Pages actually parsed, after the page cap — not the PDF's true length. */
    pageCount: integer("page_count"),
    truncated: boolean("truncated").default(false).notNull(),
    title: text("title"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("document_owner_sha_idx").on(t.ownerSessionId, t.sha256),
    index("document_owner_created_idx").on(t.ownerSessionId, t.createdAt),
    index("document_user_created_idx").on(t.userId, t.createdAt),
  ],
);

/**
 * A page-aware chunk of an uploaded document. `embedding` stays null until
 * phase 2 (`ensureIndexed`) runs, so phase 1 can respond in seconds; retrieval
 * falls back to term overlap while vectors are missing. `embeddingModelId` is
 * stored for the same reason `work_embedding` stores it — a model change must
 * be a cache miss, never a silent comparison across vector spaces.
 */
export const documentChunk = pgTable(
  "document_chunk",
  {
    id: serial("id").primaryKey(),
    documentId: text("document_id").notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    pageStart: integer("page_start").notNull(),
    pageEnd: integer("page_end").notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    embeddingModelId: text("embedding_model_id"),
  },
  (t) => [
    uniqueIndex("document_chunk_doc_index_idx").on(t.documentId, t.chunkIndex),
    index("document_chunk_doc_idx").on(t.documentId),
    index("document_chunk_vector_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

// ---------------------------------------------------------------------------
// Accounts and library (sub-project #5)
// ---------------------------------------------------------------------------

/**
 * The four tables below are better-auth's, declared here rather than generated
 * so `drizzle-kit` and the app share one schema of record. Column names follow
 * better-auth's expected snake_case mapping exactly — its Drizzle adapter looks
 * them up by name, so renaming any of these breaks sign-in at runtime rather
 * than at compile time.
 */
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    /** Required by better-auth 1.7 — it identifies the account's issuing
     * authority ("credential" for email+password). Verified against
     * `getAuthTables()` rather than guessed: a missing column here is a 500 on
     * sign-up, not a type error. */
    issuer: text("issuer").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    idToken: text("id_token"),
    /** Hashed by better-auth. Never selected into any DTO — see lib/auth/dto.ts. */
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

/**
 * A named group over saved items, holding both papers and uploads.
 *
 * `publicId` is unguessable and, today, entirely unused: nothing exposes it and
 * no route accepts it as a sharing token. It exists so that sharing, if it is
 * ever built, is a feature rather than a migration on a table that by then has
 * rows in it.
 */
export const collection = pgTable(
  "collection",
  {
    id: serial("id").primaryKey(),
    publicId: text("public_id").notNull().unique(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("collection_user_name_idx").on(t.userId, t.name),
    index("collection_user_updated_idx").on(t.userId, t.updatedAt),
  ],
);

/**
 * One saved thing — a search result or an uploaded document — deliberately
 * polymorphic rather than two parallel tables. Collections must hold both, and
 * a `collection_item` with two nullable parent columns is strictly worse than
 * one layer of indirection through a single saved-item identity. A CHECK
 * constraint (see migration 0012) keeps the polymorphism honest in the database
 * rather than in application code.
 *
 * `workSnapshot` stores the `CanonicalWork` as it was at save time. The `work`
 * table exists, but `persistWorks` writes to it un-awaited and best-effort, so
 * for any given paper the row may be stale or absent — especially on an
 * instance whose database was down when the search ran. A saved paper that
 * renders as an empty row because a provider changed its record is a broken
 * feature, so the library renders from the snapshot.
 */
export const savedItem = pgTable(
  "saved_item",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** 'work' | 'document' */
    itemType: text("item_type").notNull(),
    workKey: text("work_key"),
    documentId: text("document_id"),
    workSnapshot: jsonb("work_snapshot"),
    /** One short line. Deliberately not a notes feature — see the #5 spec. */
    note: text("note"),
    savedAt: timestamp("saved_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("saved_item_user_work_idx").on(t.userId, t.workKey),
    uniqueIndex("saved_item_user_document_idx").on(t.userId, t.documentId),
    index("saved_item_user_saved_idx").on(t.userId, t.savedAt),
  ],
);

export const collectionItem = pgTable(
  "collection_item",
  {
    id: serial("id").primaryKey(),
    collectionId: integer("collection_id")
      .notNull()
      .references(() => collection.id, { onDelete: "cascade" }),
    savedItemId: integer("saved_item_id")
      .notNull()
      .references(() => savedItem.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    addedAt: timestamp("added_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("collection_item_pair_idx").on(t.collectionId, t.savedItemId),
    index("collection_item_order_idx").on(t.collectionId, t.position),
  ],
);

// ---------------------------------------------------------------------------
// Credits and capacity (sub-project #6)
// ---------------------------------------------------------------------------

/**
 * A pool of donated or operator-owned AI capacity.
 *
 * `credentialRef` holds the NAME of an environment variable, never a key. The
 * secret lives in the environment exactly like every other credential in this
 * project. A sponsor onboarding flow that accepts a pasted API key into a web
 * form is an explicit non-goal — sponsorship is operator-mediated, which is
 * slower than self-serve and correct.
 */
export const capacitySource = pgTable(
  "capacity_source",
  {
    id: text("id").primaryKey(),
    label: text("label").notNull(),
    /** anthropic | groq | sambanova | mistral | openrouter | gemini */
    providerId: text("provider_id").notNull(),
    /** The NAME of an env var. Never a secret. Null only for an endpoint that
     * needs no credential at all — a campus vLLM node on a private network. */
    credentialRef: text("credential_ref"),
    /** OpenAI-compatible endpoint for `outpost` and `node` sources. A URL, not
     * a secret: this is how a lab donates capacity without exporting its key. */
    baseUrl: text("base_url"),
    /** The single model an endpoint serves; used for both tiers, since a
     * donated node runs what it runs. Null for the named providers. */
    servedModel: text("served_model"),
    /** UTC window this source may be used in, `HH:MM-HH:MM`, wrapping past
     * midnight. Null = always. Donated cluster time is usually off-peak. */
    activeHoursUtc: text("active_hours_utc"),
    /** ISO weekday numbers the window applies on, `1,2,3,4,5`. Null = daily. */
    activeDays: text("active_days"),
    /** Set when the dispatcher trips this source out of rotation; it becomes
     * eligible again once the clock passes. */
    dormantUntil: timestamp("dormant_until", { withTimezone: true }),
    /** Null for operator-owned capacity. */
    sponsorName: text("sponsor_name"),
    sponsorUrl: text("sponsor_url"),
    isPublic: boolean("is_public").default(false).notNull(),
    /** Null = uncapped. */
    monthlyTokenCap: bigint("monthly_token_cap", { mode: "number" }),
    tokensUsedPeriod: bigint("tokens_used_period", { mode: "number" }).default(0).notNull(),
    periodStartsAt: timestamp("period_starts_at", { withTimezone: true }).defaultNow().notNull(),
    /** active | exhausted | dormant | disabled */
    status: text("status").notNull().default("active"),
  },
  (t) => [index("capacity_source_status_idx").on(t.status, t.providerId)],
);

/**
 * Append-only. One row per credit event, each carrying the reason and the
 * balance it produced.
 *
 * A bare balance column can tell someone *12* but never *why 12*. In a commons,
 * unexplainable accounting is a trust problem rather than a UX one, which is
 * why the ledger is canonical and `credit_balance` is the derived convenience.
 */
export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    delta: integer("delta").notNull(),
    /** welcome_grant | periodic_replenishment | publication_verified |
     * peer_review_verified | spend | refund | operator_adjustment */
    reason: text("reason").notNull(),
    detail: jsonb("detail"),
    balanceAfter: integer("balance_after").notNull(),
    /** Unique per grant source, so re-running a grant awards nothing twice. */
    idempotencyKey: text("idempotency_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("credit_ledger_user_created_idx").on(t.userId, t.createdAt)],
);

export const creditBalance = pgTable("credit_balance", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  balance: integer("balance").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * An ORCID iD proven by OAuth, not typed into a box.
 *
 * Kept out of the `user` table on purpose: better-auth owns that schema, and a
 * column it does not know about is a column its own migrations may one day
 * disagree with.
 */
export const orcidIdentity = pgTable(
  "orcid_identity",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    orcid: text("orcid").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }).defaultNow().notNull(),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("orcid_identity_orcid_idx").on(t.orcid)],
);

/**
 * A per-browser allowance for people with no account, keyed on #2's session
 * cookie. Anonymous visitors have no identity that can hold a balance, so they
 * hold none — but without some allowance, "use it logged out" is the hole that
 * makes the whole system decorative.
 */
export const anonymousAllowance = pgTable("anonymous_allowance", {
  sessionId: text("session_id").primaryKey(),
  used: integer("used").default(0).notNull(),
  periodStartsAt: timestamp("period_starts_at", { withTimezone: true }).defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// Extracted data and evidence matrices (sub-project #7)
// ---------------------------------------------------------------------------

/** One extraction run per document per kind. Re-extracting replaces, so a
 * document never accumulates two contradictory sets of numbers. */
export const extraction = pgTable(
  "extraction",
  {
    id: serial("id").primaryKey(),
    documentId: text("document_id")
      .notNull()
      .references(() => document.documentId, { onDelete: "cascade" }),
    /** 'tables' | 'findings' */
    kind: text("kind").notNull(),
    /** pending | ready | failed */
    status: text("status").notNull().default("pending"),
    modelId: text("model_id"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("extraction_document_kind_idx").on(t.documentId, t.kind)],
);

export const extractedTable = pgTable(
  "extracted_table",
  {
    id: serial("id").primaryKey(),
    documentId: text("document_id")
      .notNull()
      .references(() => document.documentId, { onDelete: "cascade" }),
    pageNumber: integer("page_number").notNull(),
    caption: text("caption"),
    /** Row-major string[][] exactly as `detectTables` produced it. Stored raw
     * so an interpretation can be recomputed or discarded without re-parsing
     * the PDF — and so the grid survives a bad interpretation. */
    grid: jsonb("grid").notNull(),
    headerRow: integer("header_row"),
    units: jsonb("units"),
    confidence: real("confidence").notNull(),
    description: text("description"),
  },
  (t) => [index("extracted_table_document_page_idx").on(t.documentId, t.pageNumber)],
);

export const extractedFinding = pgTable(
  "extracted_finding",
  {
    id: serial("id").primaryKey(),
    documentId: text("document_id")
      .notNull()
      .references(() => document.documentId, { onDelete: "cascade" }),
    pageNumber: integer("page_number").notNull(),
    field: text("field").notNull(),
    value: text("value").notNull(),
    unit: text("unit"),
    /** Verbatim from the source chunk. A finding without one never reaches
     * this table — see lib/extraction/guards.ts. */
    quote: text("quote").notNull(),
  },
  (t) => [index("extracted_finding_document_field_idx").on(t.documentId, t.field)],
);

/** Ownership mirrors #5's `Owner` exactly: a nullable userId beside an
 * anonymous session id, adopted by the same UPDATE on sign-in. */
export const matrix = pgTable(
  "matrix",
  {
    id: serial("id").primaryKey(),
    publicId: text("public_id").notNull().unique(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    ownerSessionId: text("owner_session_id"),
    title: text("title").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("matrix_user_idx").on(t.userId, t.updatedAt),
    index("matrix_session_idx").on(t.ownerSessionId, t.updatedAt),
  ],
);

export const matrixColumn = pgTable(
  "matrix_column",
  {
    id: serial("id").primaryKey(),
    matrixId: integer("matrix_id")
      .notNull()
      .references(() => matrix.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    label: text("label").notNull(),
    hint: text("hint"),
    /** text | number | list */
    valueType: text("value_type").notNull().default("text"),
  },
  (t) => [index("matrix_column_order_idx").on(t.matrixId, t.position)],
);

export const matrixRow = pgTable(
  "matrix_row",
  {
    id: serial("id").primaryKey(),
    matrixId: integer("matrix_id")
      .notNull()
      .references(() => matrix.id, { onDelete: "cascade" }),
    documentId: text("document_id")
      .notNull()
      .references(() => document.documentId, { onDelete: "cascade" }),
    position: integer("position").notNull(),
  },
  (t) => [
    uniqueIndex("matrix_row_document_idx").on(t.matrixId, t.documentId),
    index("matrix_row_order_idx").on(t.matrixId, t.position),
  ],
);

/**
 * `status` is the point of this table.
 *
 * A blank cell must mean "this paper does not report that" and never "the
 * extractor gave up" — those are different facts about the literature, and
 * conflating them is how an evidence matrix misleads a systematic review.
 */
export const matrixCell = pgTable(
  "matrix_cell",
  {
    id: serial("id").primaryKey(),
    matrixId: integer("matrix_id")
      .notNull()
      .references(() => matrix.id, { onDelete: "cascade" }),
    rowId: integer("row_id")
      .notNull()
      .references(() => matrixRow.id, { onDelete: "cascade" }),
    columnId: integer("column_id")
      .notNull()
      .references(() => matrixColumn.id, { onDelete: "cascade" }),
    value: text("value"),
    unit: text("unit"),
    quote: text("quote"),
    pageNumber: integer("page_number"),
    /** found | not_reported | error */
    status: text("status").notNull(),
    error: text("error"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("matrix_cell_pair_idx").on(t.rowId, t.columnId)],
);

// ---------------------------------------------------------------------------
// Manuscripts (sub-project #8)
// ---------------------------------------------------------------------------

/**
 * `userId` is NOT NULL, and it is the only place in this app that refuses
 * anonymous ownership.
 *
 * Everywhere else a browser-scoped identity is a convenience. For a manuscript
 * it is a data-loss trap dressed as one: a cleared cookie takes the writing
 * with it, and nobody expects a word processor to work that way.
 */
export const manuscript = pgTable(
  "manuscript",
  {
    id: serial("id").primaryKey(),
    publicId: text("public_id").notNull().unique(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    /** Tiptap/ProseMirror JSON. Citations are inline atom nodes carrying only a
     * workKey — no number, no label — so order and style are derived. */
    doc: jsonb("doc").notNull(),
    citationStyle: text("citation_style").notNull().default("apa"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("manuscript_user_updated_idx").on(t.userId, t.updatedAt)],
);

/** Snapshots on a coarser cadence than autosave, capped as a ring. An editor
 * that can lose a manuscript is worse than no editor. */
export const manuscriptRevision = pgTable(
  "manuscript_revision",
  {
    id: serial("id").primaryKey(),
    manuscriptId: integer("manuscript_id")
      .notNull()
      .references(() => manuscript.id, { onDelete: "cascade" }),
    doc: jsonb("doc").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("manuscript_revision_idx").on(t.manuscriptId, t.createdAt)],
);
