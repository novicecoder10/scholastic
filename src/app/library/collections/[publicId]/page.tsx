import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CollectionView } from "@/components/library/CollectionView";
import { requireUser } from "@/lib/auth/dal";
import { findCollection, listCollectionItems } from "@/lib/library/repository";

export const metadata: Metadata = { title: "Collection" };
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ publicId: string }>;
}

export default async function CollectionPage({ params }: PageProps) {
  const { publicId } = await params;
  // A library page redirects to /login rather than answering 401 — someone who
  // simply hasn't signed in yet should get a form, not an error.
  const user = await requireUser(`/library/collections/${publicId}`);

  const found = await findCollection(user.id, publicId);
  // Another user's collection is indistinguishable from one that isn't there.
  if (!found) notFound();

  const items = await listCollectionItems(found.id);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-8">
      <Link href="/library" className="text-muted hover:text-ink text-xs">
        ← Library
      </Link>
      <h1 className="text-ink mt-2 text-2xl font-semibold tracking-tight">{found.name}</h1>
      {found.description && <p className="text-muted mt-1 text-sm">{found.description}</p>}
      {items.length > 1 && (
        <Link
          href={`/graph?collection=${encodeURIComponent(found.publicId)}`}
          className="text-link mt-2 inline-block text-xs hover:underline"
        >
          See this collection as a citation graph ↗
        </Link>
      )}
      <div className="mt-6">
        <CollectionView publicId={found.publicId} name={found.name} initialItems={items} />
      </div>
    </main>
  );
}
