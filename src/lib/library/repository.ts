import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, max, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { collection, collectionItem, document, savedItem } from "@/lib/db/schema";
import type { CanonicalWork } from "@/lib/types/work";

export type SavedItemType = "work" | "document";

export interface SavedItemRecord {
  id: number;
  itemType: SavedItemType;
  workKey: string | null;
  documentId: string | null;
  /** The `CanonicalWork` as it looked when saved. See the schema comment for
   * why the library renders from this rather than the live `work` row. */
  workSnapshot: CanonicalWork | null;
  note: string | null;
  savedAt: Date;
  /** Filled for document items so the library can show a filename without a
   * second query. Null for saved papers. */
  filename: string | null;
}

export interface CollectionRecord {
  id: number;
  publicId: string;
  name: string;
  description: string | null;
  itemCount: number;
  updatedAt: Date;
}

/** Unguessable, and today unused — see the schema comment on `publicId`. */
export function newPublicId(): string {
  return randomBytes(18).toString("base64url");
}

function toSavedItem(row: typeof savedItem.$inferSelect, filename: string | null): SavedItemRecord {
  return {
    id: row.id,
    itemType: row.itemType as SavedItemType,
    workKey: row.workKey,
    documentId: row.documentId,
    workSnapshot: (row.workSnapshot as CanonicalWork | null) ?? null,
    note: row.note,
    savedAt: row.savedAt,
    filename,
  };
}

// ---------------------------------------------------------------------------
// Saved items
// ---------------------------------------------------------------------------

/**
 * Saving is idempotent: the unique index on (userId, workKey) turns a second
 * save of the same paper into an update of its snapshot rather than an error
 * the UI would have to interpret. A user clicking Save twice has expressed one
 * intention, not made a mistake.
 */
export async function saveWork(
  userId: string,
  work: CanonicalWork,
  note: string | null = null,
): Promise<SavedItemRecord> {
  const [row] = await getDb()
    .insert(savedItem)
    .values({
      userId,
      itemType: "work",
      workKey: work.workKey,
      documentId: null,
      workSnapshot: work,
      note,
    })
    .onConflictDoUpdate({
      target: [savedItem.userId, savedItem.workKey],
      // The index is PARTIAL (`WHERE work_key IS NOT NULL`), and Postgres will
      // not infer a partial index from the column list alone — without this
      // predicate the insert fails with "no unique or exclusion constraint
      // matching the ON CONFLICT specification".
      targetWhere: isNotNull(savedItem.workKey),
      set: { workSnapshot: work, ...(note !== null ? { note } : {}) },
    })
    .returning();
  return toSavedItem(row, null);
}

export async function saveDocument(userId: string, documentId: string): Promise<SavedItemRecord> {
  const [row] = await getDb()
    .insert(savedItem)
    .values({ userId, itemType: "document", workKey: null, documentId })
    .onConflictDoUpdate({
      target: [savedItem.userId, savedItem.documentId],
      targetWhere: isNotNull(savedItem.documentId),
      set: { savedAt: new Date() },
    })
    .returning();
  return toSavedItem(row, null);
}

/** Scoped by userId in the WHERE clause, like every ownership check in this
 * app — unsaving someone else's item is indistinguishable from unsaving one
 * that never existed. */
export async function unsave(userId: string, savedItemId: number): Promise<boolean> {
  const deleted = await getDb()
    .delete(savedItem)
    .where(and(eq(savedItem.userId, userId), eq(savedItem.id, savedItemId)))
    .returning({ id: savedItem.id });
  return deleted.length > 0;
}

export async function unsaveWork(userId: string, workKey: string): Promise<boolean> {
  const deleted = await getDb()
    .delete(savedItem)
    .where(and(eq(savedItem.userId, userId), eq(savedItem.workKey, workKey)))
    .returning({ id: savedItem.id });
  return deleted.length > 0;
}

/** A left join, not two queries: a document item needs its filename, and a
 * saved document whose upload was deleted must still list (with a null
 * filename) rather than disappearing from the library without explanation. */
export async function listSavedItems(
  userId: string,
  itemType?: SavedItemType,
): Promise<SavedItemRecord[]> {
  const rows = await getDb()
    .select({ item: savedItem, filename: document.filename })
    .from(savedItem)
    .leftJoin(document, eq(document.documentId, savedItem.documentId))
    .where(
      itemType
        ? and(eq(savedItem.userId, userId), eq(savedItem.itemType, itemType))
        : eq(savedItem.userId, userId),
    )
    .orderBy(desc(savedItem.savedAt));
  return rows.map((r) => toSavedItem(r.item, r.filename));
}

/** Which of these workKeys the user has already saved, so result cards can
 * render the right Save state in one query rather than one per card. */
export async function savedWorkKeys(userId: string, workKeys: string[]): Promise<Set<string>> {
  if (workKeys.length === 0) return new Set();
  // inArray, not a hand-built ARRAY[...] literal: workKeys come from a request
  // body, and any string-interpolated variant of this is an injection waiting
  // for a workKey containing a quote.
  const rows = await getDb()
    .select({ workKey: savedItem.workKey })
    .from(savedItem)
    .where(and(eq(savedItem.userId, userId), inArray(savedItem.workKey, workKeys)));
  return new Set(rows.map((r) => r.workKey).filter((k): k is string => k !== null));
}

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------

/** SQLSTATE 23505. */
const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(err: unknown, constraintName: string): boolean {
  for (let current = err; current; current = (current as { cause?: unknown }).cause) {
    const candidate = current as {
      code?: unknown;
      constraint_name?: unknown;
      constraint?: unknown;
    };
    if (candidate.code !== UNIQUE_VIOLATION) continue;
    const named = candidate.constraint_name ?? candidate.constraint;
    if (named === undefined || named === constraintName) return true;
  }
  return false;
}

export class DuplicateCollectionNameError extends Error {
  constructor(name: string) {
    super(`You already have a collection called "${name}".`);
    this.name = "DuplicateCollectionNameError";
  }
}

export async function createCollection(
  userId: string,
  name: string,
  description: string | null = null,
): Promise<CollectionRecord> {
  try {
    const [row] = await getDb()
      .insert(collection)
      .values({ publicId: newPublicId(), userId, name, description })
      .returning();
    return {
      id: row.id,
      publicId: row.publicId,
      name: row.name,
      description: row.description,
      itemCount: 0,
      updatedAt: row.updatedAt,
    };
  } catch (err) {
    // The unique index is the source of truth; catching the violation beats a
    // check-then-insert that two concurrent requests can both pass.
    //
    // Matched on the driver error rather than the message: drizzle wraps the
    // PostgresError in a generic `Error: Failed query: …` whose text carries
    // neither the SQLSTATE nor the constraint name, so a substring match on the
    // outer error silently never fires — and the user gets a 503 where they
    // should get a 409.
    if (isUniqueViolation(err, "collection_user_name_idx")) {
      throw new DuplicateCollectionNameError(name);
    }
    throw err;
  }
}

export async function listCollections(userId: string): Promise<CollectionRecord[]> {
  const rows = await getDb()
    .select({
      id: collection.id,
      publicId: collection.publicId,
      name: collection.name,
      description: collection.description,
      updatedAt: collection.updatedAt,
      itemCount: sql<number>`count(${collectionItem.id})::int`,
    })
    .from(collection)
    .leftJoin(collectionItem, eq(collectionItem.collectionId, collection.id))
    .where(eq(collection.userId, userId))
    .groupBy(collection.id)
    .orderBy(desc(collection.updatedAt));
  return rows;
}

/** Looked up by publicId AND userId together. A collection belonging to
 * someone else returns null, so the caller answers 404 rather than 403 — the
 * same reasoning as #2's capability documents. */
export async function findCollection(
  userId: string,
  publicId: string,
): Promise<CollectionRecord | null> {
  const [row] = await getDb()
    .select()
    .from(collection)
    .where(and(eq(collection.userId, userId), eq(collection.publicId, publicId)))
    .limit(1);
  if (!row) return null;
  const [{ count }] = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(collectionItem)
    .where(eq(collectionItem.collectionId, row.id));
  return {
    id: row.id,
    publicId: row.publicId,
    name: row.name,
    description: row.description,
    itemCount: count,
    updatedAt: row.updatedAt,
  };
}

export async function deleteCollection(userId: string, publicId: string): Promise<boolean> {
  const deleted = await getDb()
    .delete(collection)
    .where(and(eq(collection.userId, userId), eq(collection.publicId, publicId)))
    .returning({ id: collection.id });
  return deleted.length > 0;
}

export async function listCollectionItems(collectionId: number): Promise<SavedItemRecord[]> {
  const rows = await getDb()
    .select({ item: savedItem, filename: document.filename })
    .from(collectionItem)
    .innerJoin(savedItem, eq(savedItem.id, collectionItem.savedItemId))
    .leftJoin(document, eq(document.documentId, savedItem.documentId))
    .where(eq(collectionItem.collectionId, collectionId))
    .orderBy(asc(collectionItem.position));
  return rows.map((r) => toSavedItem(r.item, r.filename));
}

/**
 * Adding is scoped by userId on BOTH sides — the collection and the saved item
 * must belong to the caller. Checking only the collection would let a user
 * pull another user's saved item into their own collection and read its
 * snapshot.
 */
export async function addToCollection(
  userId: string,
  publicId: string,
  savedItemId: number,
): Promise<boolean> {
  const db = getDb();
  const target = await findCollection(userId, publicId);
  if (!target) return false;

  const [owned] = await db
    .select({ id: savedItem.id })
    .from(savedItem)
    .where(and(eq(savedItem.userId, userId), eq(savedItem.id, savedItemId)))
    .limit(1);
  if (!owned) return false;

  const [{ highest }] = await db
    .select({ highest: max(collectionItem.position) })
    .from(collectionItem)
    .where(eq(collectionItem.collectionId, target.id));

  await db
    .insert(collectionItem)
    .values({ collectionId: target.id, savedItemId, position: (highest ?? -1) + 1 })
    .onConflictDoNothing();
  await db.update(collection).set({ updatedAt: new Date() }).where(eq(collection.id, target.id));
  return true;
}

export async function removeFromCollection(
  userId: string,
  publicId: string,
  savedItemId: number,
): Promise<boolean> {
  const target = await findCollection(userId, publicId);
  if (!target) return false;
  const deleted = await getDb()
    .delete(collectionItem)
    .where(
      and(eq(collectionItem.collectionId, target.id), eq(collectionItem.savedItemId, savedItemId)),
    )
    .returning({ id: collectionItem.id });
  return deleted.length > 0;
}

/**
 * Rewrites positions from an explicit ordered list of saved-item ids.
 *
 * One transaction, and ids not already in the collection are ignored rather
 * than inserted: a reorder request is about order, and letting it also add
 * members would make a dropped-connection retry produce a different collection
 * than the user saw.
 */
export async function reorderCollection(
  userId: string,
  publicId: string,
  orderedSavedItemIds: number[],
): Promise<boolean> {
  const target = await findCollection(userId, publicId);
  if (!target) return false;

  await getDb().transaction(async (tx) => {
    for (const [position, savedItemId] of orderedSavedItemIds.entries()) {
      await tx
        .update(collectionItem)
        .set({ position })
        .where(
          and(
            eq(collectionItem.collectionId, target.id),
            eq(collectionItem.savedItemId, savedItemId),
          ),
        );
    }
    await tx.update(collection).set({ updatedAt: new Date() }).where(eq(collection.id, target.id));
  });
  return true;
}
