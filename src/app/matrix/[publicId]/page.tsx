import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MatrixGrid, type GridCell } from "@/components/matrix/MatrixGrid";
import { readOwner } from "@/lib/auth/owner";
import { listOwned } from "@/lib/documents/repository";
import { documentTitles, findMatrix, matrixContents } from "@/lib/extraction/repository";

export const metadata: Metadata = { title: "Evidence matrix" };
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ publicId: string }>;
}

export default async function MatrixPage({ params }: PageProps) {
  const { publicId } = await params;
  const owner = await readOwner();
  // Someone else's matrix is indistinguishable from one that isn't there.
  if (!owner) notFound();

  const found = await findMatrix(owner, publicId);
  if (!found) notFound();

  const [{ columns, rows, cells }, documents] = await Promise.all([
    matrixContents(found.id),
    listOwned(owner),
  ]);
  const titles = await documentTitles(rows.map((r) => r.documentId));

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-8">
      <Link href="/matrix" className="text-muted hover:text-ink text-xs">
        ← Evidence matrices
      </Link>
      <h1 className="text-ink mt-2 mb-6 text-2xl font-semibold tracking-tight">{found.title}</h1>
      <MatrixGrid
        publicId={found.publicId}
        columns={columns}
        rows={rows.map((r) => ({
          id: r.id,
          documentId: r.documentId,
          title: titles.get(r.documentId) ?? r.documentId,
        }))}
        cells={cells as GridCell[]}
        documents={documents.map((d) => ({
          documentId: d.documentId,
          label: d.title ?? d.filename,
        }))}
      />
    </main>
  );
}
