import type { Metadata } from "next";
import { UploadPanel } from "@/components/reader/UploadPanel";
import { listOwned } from "@/lib/documents/repository";
import { readOwner } from "@/lib/auth/owner";
import { logger } from "@/lib/log/logger";

export const metadata: Metadata = {
  title: "Reader",
  description: "Upload a paper and ask questions about its full text.",
};

// The session cookie is read, never minted, here: a Server Component can't
// write cookies during render. A first-time visitor sees an empty list and
// gets their cookie from the upload POST itself.
export const dynamic = "force-dynamic";

export default async function ReaderIndexPage() {
  const owner = await readOwner();
  let documents: Awaited<ReturnType<typeof listOwned>> = [];
  if (owner) {
    try {
      documents = await listOwned(owner);
    } catch (err) {
      // The upload path still returns a real 503 if the store is down; the
      // list is not worth failing the whole page over.
      logger.warn(
        { event: "reader_list_failed", err: String(err) },
        "couldn't list documents for the reader",
      );
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-8">
      <h1 className="text-ink text-2xl font-semibold tracking-tight">Read a paper</h1>
      <p className="text-muted mt-1 mb-6 text-sm">
        Search answers from abstracts. Upload the PDF and you can ask what the abstract never says —
        the sample size, the dataset, what the limitations concede.
      </p>
      <UploadPanel
        initialDocuments={documents.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() }))}
      />
    </main>
  );
}
