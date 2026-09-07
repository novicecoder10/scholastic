import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ManuscriptEditor } from "@/components/manuscript/ManuscriptEditor";
import { requireUser } from "@/lib/auth/dal";
import { getActiveLlmProvider } from "@/lib/ai/llm";
import { buildBibliography, collectCitedWorkKeys } from "@/lib/manuscript/bibliography";
import { findManuscript } from "@/lib/manuscript/repository";
import { resolveWorks } from "@/lib/manuscript/resolve";
import { listSavedItems } from "@/lib/library/repository";
import type { CitationStyle } from "@/lib/citations";
import type { CanonicalWork } from "@/lib/types/work";
import type { DocNode } from "@/lib/manuscript/types";

export const metadata: Metadata = { title: "Manuscript" };
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ publicId: string }>;
}

export default async function ManuscriptPage({ params }: PageProps) {
  const { publicId } = await params;
  const user = await requireUser(`/write/${publicId}`);

  const found = await findManuscript(user.id, publicId);
  // Someone else's manuscript is indistinguishable from one that isn't there.
  if (!found) notFound();

  const doc = found.doc as DocNode;
  const order = collectCitedWorkKeys(doc);
  const [resolved, saved] = await Promise.all([
    resolveWorks(user.id, order),
    listSavedItems(user.id, "work"),
  ]);

  const savedWorks = saved
    .map((item) => ({ workKey: item.workKey, snapshot: item.workSnapshot as CanonicalWork | null }))
    .filter((entry): entry is { workKey: string; snapshot: CanonicalWork } =>
      Boolean(entry.workKey && entry.snapshot),
    )
    .map(({ workKey, snapshot }) => ({
      workKey,
      title: snapshot.title,
      authors: snapshot.authors.slice(0, 3).map((a) => a.name),
      year: snapshot.year,
    }));

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-8">
      <Link href="/write" className="text-muted hover:text-ink text-xs">
        ← Manuscripts
      </Link>
      <h1 className="text-ink mt-2 mb-6 text-2xl font-semibold tracking-tight">{found.title}</h1>
      <ManuscriptEditor
        publicId={found.publicId}
        title={found.title}
        initialDoc={doc}
        initialStyle={found.citationStyle as CitationStyle}
        initialBibliography={buildBibliography(
          order,
          resolved,
          found.citationStyle as CitationStyle,
        )}
        savedWorks={savedWorks}
        aiEnabled={getActiveLlmProvider() !== null}
      />
    </main>
  );
}
