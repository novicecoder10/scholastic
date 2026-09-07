import { randomBytes } from "node:crypto";
import { and, desc, eq, lt } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { manuscript, manuscriptRevision } from "@/lib/db/schema";
import type { DocNode } from "@/lib/manuscript/types";

function newPublicId(): string {
  return randomBytes(18).toString("base64url");
}

export const EMPTY_DOC: DocNode = { type: "doc", content: [{ type: "paragraph" }] };

/** Keeps the ring bounded. Enough to recover from an accidental select-all
 * delete an hour ago; not so many that a busy editor stores a hundred copies of
 * a long document. */
export const MAX_REVISIONS = 20;

/** A snapshot is taken at most this often. Autosave is debounced in seconds;
 * revisions are a coarser safety net, and one per keystroke burst would be a
 * hundred near-identical blobs. */
export const REVISION_INTERVAL_MS = 5 * 60 * 1000;

export async function createManuscript(userId: string, title: string) {
  const [row] = await getDb()
    .insert(manuscript)
    .values({ publicId: newPublicId(), userId, title, doc: EMPTY_DOC })
    .returning();
  return row;
}

export async function listManuscripts(userId: string) {
  return getDb()
    .select({
      publicId: manuscript.publicId,
      title: manuscript.title,
      updatedAt: manuscript.updatedAt,
    })
    .from(manuscript)
    .where(eq(manuscript.userId, userId))
    .orderBy(desc(manuscript.updatedAt));
}

/** Scoped by userId in the WHERE clause, so someone else's manuscript is
 * indistinguishable from one that does not exist. */
export async function findManuscript(userId: string, publicId: string) {
  const [row] = await getDb()
    .select()
    .from(manuscript)
    .where(and(eq(manuscript.userId, userId), eq(manuscript.publicId, publicId)))
    .limit(1);
  return row ?? null;
}

export async function deleteManuscript(userId: string, publicId: string): Promise<boolean> {
  const deleted = await getDb()
    .delete(manuscript)
    .where(and(eq(manuscript.userId, userId), eq(manuscript.publicId, publicId)))
    .returning({ id: manuscript.id });
  return deleted.length > 0;
}

export interface SaveInput {
  doc?: DocNode;
  title?: string;
  citationStyle?: string;
}

/**
 * Autosave. Snapshots into the revision ring when the last snapshot is older
 * than the interval — an editor that can lose a manuscript is worse than no
 * editor, and the cheapest insurance is a copy the user never has to ask for.
 */
export async function saveManuscript(
  userId: string,
  publicId: string,
  input: SaveInput,
): Promise<boolean> {
  const existing = await findManuscript(userId, publicId);
  if (!existing) return false;

  if (input.doc) await maybeSnapshot(existing.id, existing.doc as DocNode);

  await getDb()
    .update(manuscript)
    .set({
      ...(input.doc ? { doc: input.doc } : {}),
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.citationStyle ? { citationStyle: input.citationStyle } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(manuscript.userId, userId), eq(manuscript.publicId, publicId)));
  return true;
}

async function maybeSnapshot(manuscriptId: number, previous: DocNode): Promise<void> {
  const db = getDb();
  const [latest] = await db
    .select({ createdAt: manuscriptRevision.createdAt })
    .from(manuscriptRevision)
    .where(eq(manuscriptRevision.manuscriptId, manuscriptId))
    .orderBy(desc(manuscriptRevision.createdAt))
    .limit(1);

  if (latest && Date.now() - latest.createdAt.getTime() < REVISION_INTERVAL_MS) return;

  // The revision stores the document as it was BEFORE this save: what a reader
  // wants back is the state they lost, not the one they already have.
  await db.insert(manuscriptRevision).values({ manuscriptId, doc: previous });
  await evictOldRevisions(manuscriptId);
}

async function evictOldRevisions(manuscriptId: number): Promise<void> {
  const keep = await getDb()
    .select({ createdAt: manuscriptRevision.createdAt })
    .from(manuscriptRevision)
    .where(eq(manuscriptRevision.manuscriptId, manuscriptId))
    .orderBy(desc(manuscriptRevision.createdAt))
    .limit(MAX_REVISIONS);

  const oldest = keep.at(-1)?.createdAt;
  if (!oldest || keep.length < MAX_REVISIONS) return;

  await getDb()
    .delete(manuscriptRevision)
    .where(
      and(
        eq(manuscriptRevision.manuscriptId, manuscriptId),
        lt(manuscriptRevision.createdAt, oldest),
      ),
    );
}

export async function listRevisions(manuscriptId: number) {
  return getDb()
    .select({ id: manuscriptRevision.id, createdAt: manuscriptRevision.createdAt })
    .from(manuscriptRevision)
    .where(eq(manuscriptRevision.manuscriptId, manuscriptId))
    .orderBy(desc(manuscriptRevision.createdAt));
}

export async function getRevision(manuscriptId: number, revisionId: number) {
  const [row] = await getDb()
    .select()
    .from(manuscriptRevision)
    .where(
      and(eq(manuscriptRevision.manuscriptId, manuscriptId), eq(manuscriptRevision.id, revisionId)),
    )
    .limit(1);
  return row ?? null;
}
