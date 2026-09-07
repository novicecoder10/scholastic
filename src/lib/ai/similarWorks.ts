import { and, eq, ne, asc } from "drizzle-orm";
import { cosineDistance } from "drizzle-orm/sql/functions/vector";
import { getDb } from "@/lib/db/client";
import { work, workEmbedding, type WorkAuthor } from "@/lib/db/schema";
import { getActiveEmbeddingProvider } from "@/lib/ai/embeddings";
import { getOrComputeEmbeddings } from "@/lib/ai/embeddings/cache";
import { WorkNotFoundError } from "@/lib/ai/errors";

const DEFAULT_LIMIT = 10;

export interface SimilarWork {
  workKey: string;
  title: string;
  authors: WorkAuthor[];
  year: number | null;
  venue: string | null;
  doi: string | null;
  landingPageUrl: string | null;
  pdfUrl: string | null;
  isOpenAccess: boolean | null;
  citationCount: number | null;
  similarity: number;
}

/**
 * "More like this," scoped to works already present in the corpus (i.e.
 * previously searched-for and persisted via workPersistence.ts) — not a live
 * fan-out to the 9 providers. This is the first real use of the
 * `work_embedding_vector_idx` HNSW index (provisioned since Milestone 2 but
 * never queried via ANN until now); everything before this scored candidate
 * similarity in-process against one request's live results.
 *
 * A work that has never been embedded (e.g. only ever surfaced via keyword
 * search) is embedded on demand here via getOrComputeEmbeddings — required,
 * not optional, since there is no vector to rank the corpus against
 * otherwise. That embedding is cached as a side effect for future reuse.
 */
export async function getSimilarWorks(
  workKey: string,
  limit: number = DEFAULT_LIMIT,
): Promise<SimilarWork[]> {
  const db = getDb();

  const seedRows = await db.select().from(work).where(eq(work.workKey, workKey)).limit(1);
  const seed = seedRows[0];
  if (!seed) {
    throw new WorkNotFoundError(workKey);
  }

  const provider = getActiveEmbeddingProvider();
  const embeddings = await getOrComputeEmbeddings(
    [{ workKey, text: `${seed.title}\n${seed.abstract ?? ""}` }],
    provider,
  );
  const seedEmbedding = embeddings.get(workKey);
  if (!seedEmbedding) {
    // Should not happen — getOrComputeEmbeddings always computes on a miss —
    // but fail loudly rather than silently returning an empty result if it ever does.
    throw new Error(`Failed to compute an embedding for workKey "${workKey}"`);
  }

  const distance = cosineDistance(workEmbedding.embedding, seedEmbedding).mapWith(Number);

  const rows = await db
    .select({
      workKey: work.workKey,
      title: work.title,
      authors: work.authors,
      year: work.year,
      venue: work.venue,
      doi: work.doi,
      landingPageUrl: work.landingPageUrl,
      pdfUrl: work.pdfUrl,
      isOpenAccess: work.isOpenAccess,
      citationCount: work.citationCount,
      distance,
    })
    .from(workEmbedding)
    .innerJoin(work, eq(work.workKey, workEmbedding.workKey))
    .where(
      and(eq(workEmbedding.embeddingModelId, provider.modelId), ne(workEmbedding.workKey, workKey)),
    )
    .orderBy(asc(distance))
    .limit(limit);

  return rows.map((row) => ({
    workKey: row.workKey,
    title: row.title,
    authors: row.authors,
    year: row.year,
    venue: row.venue,
    doi: row.doi,
    landingPageUrl: row.landingPageUrl,
    pdfUrl: row.pdfUrl,
    isOpenAccess: row.isOpenAccess,
    citationCount: row.citationCount,
    similarity: 1 - row.distance,
  }));
}
