import type { Metadata } from "next";
import Link from "next/link";
import { MatrixList } from "@/components/matrix/MatrixList";
import { readOwner } from "@/lib/auth/owner";
import { listMatrices } from "@/lib/extraction/repository";
import { logger } from "@/lib/log/logger";

export const metadata: Metadata = { title: "Evidence matrices" };
export const dynamic = "force-dynamic";

/** Reachable signed out, like /library and /reader: an anonymous visitor's
 * matrices belong to their browser and are adopted if they sign up. */
export default async function MatrixIndexPage() {
  const owner = await readOwner();
  let matrices: Awaited<ReturnType<typeof listMatrices>> = [];
  if (owner) {
    try {
      matrices = await listMatrices(owner);
    } catch (err) {
      logger.warn({ event: "matrix_index_failed", err: String(err) }, "matrix list degraded");
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-8">
      <h1 className="text-ink text-2xl font-semibold tracking-tight">Evidence matrices</h1>
      <p className="text-muted mt-1 mb-6 text-sm">
        Rows are your uploaded papers, columns are the fields you care about, and every filled
        cell carries the page and the sentence it came from. Add papers in the{" "}
        <Link href="/reader" className="text-link hover:underline">
          Reader
        </Link>
        .
      </p>
      <MatrixList
        matrices={matrices.map((m) => ({ ...m, updatedAt: m.updatedAt.toISOString() }))}
      />
    </main>
  );
}
