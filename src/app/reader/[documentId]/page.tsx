import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ReaderWorkspace } from "@/components/reader/ReaderWorkspace";
import { findOwned } from "@/lib/documents/repository";
import { readOwner } from "@/lib/auth/owner";

export const metadata: Metadata = { title: "Reader" };
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ documentId: string }>;
  searchParams: Promise<{ page?: string }>;
}

/** `?page=` arrives from a matrix cell's provenance link. Anything that is not
 * a page number is ignored rather than rejected — a bad query string should not
 * cost someone their document. */
function parsePage(raw: string | undefined): number | undefined {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Ownership is settled server-side, before a byte of client JavaScript runs:
 * a document this session doesn't own renders a 404 rather than fetching one.
 * Same reason as everywhere else in #2 — a distinguishable "forbidden" would
 * confirm the id is real.
 */
export default async function ReaderPage({ params, searchParams }: PageProps) {
  const { documentId } = await params;
  const { page } = await searchParams;
  const owner = await readOwner();
  if (!owner) notFound();

  const record = await findOwned(owner, documentId);
  if (!record) notFound();

  return (
    <ReaderWorkspace
      documentId={record.documentId}
      filename={record.filename}
      title={record.title}
      initialStatus={record.status}
      truncated={record.truncated}
      initialPage={parsePage(page)}
    />
  );
}
