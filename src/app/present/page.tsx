import type { Metadata } from "next";
import { DeckBuilder } from "@/components/deck/DeckBuilder";

export const metadata: Metadata = { title: "Presentation" };
export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ q?: string }>;
}

/**
 * A deck outline from the literature, with a citation on every bullet.
 *
 * The page states the constraint rather than hiding it: this summarises papers
 * it found, it does not write a talk. A slide is the format where an uncited
 * claim travels furthest — it gets photographed, quoted, and repeated by people
 * who never saw a reference list — so the guard that strips uncited bullets is
 * the feature, not a limitation of it.
 */
export default async function PresentPage({ searchParams }: PageProps) {
  const { q } = await searchParams;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-8">
      <h1 className="text-ink text-2xl font-semibold tracking-tight">Presentation</h1>
      <p className="text-muted mt-2 mb-6 text-sm">
        Searches the literature on your topic and outlines what those papers say, one claim per
        bullet, each one carrying its source. Bullets that come back without a citation are deleted
        before you see them — so this builds a deck about the papers, not a talk about the subject.
      </p>
      <DeckBuilder initialTopic={q?.trim() ?? ""} />
    </main>
  );
}
