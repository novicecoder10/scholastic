"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useCallback, useRef, useState } from "react";

interface DocumentSummary {
  documentId: string;
  filename: string;
  byteSize: number;
  status: "parsed" | "indexing" | "indexed";
  pageCount: number | null;
  title: string | null;
  createdAt: string;
}

/** #2's rejection codes, said in words a reader can act on. 422 is the one a
 * user will actually hit, and "no text layer" means nothing to them — a scanned
 * PDF is the cause roughly every time, so name it. */
function messageForStatus(status: number): string {
  switch (status) {
    case 413:
      return "That file is over the 30 MB limit.";
    case 422:
      return "No text could be extracted. Scanned PDFs aren't supported yet — they need OCR, which this instance doesn't do.";
    case 400:
      return "That didn't look like a PDF upload.";
    case 503:
      return "Uploads aren't available right now — the document store is unreachable.";
    default:
      return "Upload failed. Try again.";
  }
}

function formatSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function UploadPanel({ initialDocuments }: { initialDocuments: DocumentSummary[] }) {
  const [documents, setDocuments] = useState(initialDocuments);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const upload = useCallback(
    async (file: File) => {
      setError(null);
      setUploading(true);
      try {
        const form = new FormData();
        form.append("file", file);
        const response = await fetch("/api/documents", { method: "POST", body: form });
        if (!response.ok) {
          setError(messageForStatus(response.status));
          return;
        }
        const created = (await response.json()) as DocumentSummary;
        // Straight into the reader: uploading a paper is never the goal, and
        // an intermediate "uploaded ✓" step would just be a second click.
        router.push(`/reader/${encodeURIComponent(created.documentId)}`);
      } catch {
        setError("Upload failed. Try again.");
      } finally {
        setUploading(false);
      }
    },
    [router],
  );

  async function remove(documentId: string) {
    const response = await fetch(`/api/documents/${encodeURIComponent(documentId)}`, {
      method: "DELETE",
    });
    if (response.ok) setDocuments((prev) => prev.filter((d) => d.documentId !== documentId));
  }

  return (
    <div className="space-y-6">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files[0];
          if (file) void upload(file);
        }}
        className={`rounded-2xl border border-dashed p-10 text-center transition-colors ${
          dragging ? "border-accent bg-surface-2" : "border-line bg-surface"
        }`}
      >
        <p className="text-ink text-sm font-medium">
          {uploading ? "Uploading…" : "Drop a PDF here"}
        </p>
        <p className="text-muted mt-1 text-xs">Up to 30 MB · text-based PDFs only</p>
        <button
          type="button"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          className="bg-accent-solid text-accent-ink hover:bg-accent-solid-hover mt-4 rounded-full px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
        >
          Choose a file
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Reset so re-picking the same file after a failure still fires.
            e.target.value = "";
            if (file) void upload(file);
          }}
        />
        {error && (
          <p className="text-danger mx-auto mt-3 max-w-sm text-xs" role="alert">
            {error}
          </p>
        )}
      </div>

      <section>
        <h2 className="text-muted mb-2 text-xs font-semibold tracking-wide uppercase">
          Your documents
        </h2>
        {documents.length === 0 ? (
          <p className="text-muted text-sm">
            Nothing uploaded yet. Documents stay with this browser session — there are no accounts
            here yet.
          </p>
        ) : (
          <ul className="divide-line border-line divide-y rounded-xl border">
            {documents.map((doc) => (
              <li key={doc.documentId} className="flex items-center gap-3 px-4 py-3">
                <Link
                  href={`/reader/${encodeURIComponent(doc.documentId)}`}
                  className="min-w-0 flex-1"
                >
                  <p className="text-ink truncate text-sm">{doc.title ?? doc.filename}</p>
                  <p className="text-muted text-xs">
                    {formatSize(doc.byteSize)}
                    {doc.pageCount ? ` · ${doc.pageCount} pages` : ""}
                    {doc.status === "indexed" ? "" : " · indexing"}
                  </p>
                </Link>
                <button
                  type="button"
                  onClick={() => void remove(doc.documentId)}
                  className="text-muted hover:text-danger shrink-0 text-xs transition-colors"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
