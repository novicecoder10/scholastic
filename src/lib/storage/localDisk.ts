import { createReadStream } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { BlobNotFoundError, type BlobStore } from "@/lib/storage/blobStore";

const DEFAULT_UPLOAD_DIR = ".uploads";

/**
 * Keys arrive from callers and must never be able to escape the upload
 * directory. Rather than sanitising (a blocklist game that eventually loses),
 * this rejects anything that isn't the exact shape we generate: base64url
 * characters only, no separators, no dots.
 */
const SAFE_KEY = /^[A-Za-z0-9_-]{1,128}$/;

export function assertSafeKey(key: string): void {
  if (!SAFE_KEY.test(key)) {
    throw new Error(`Unsafe blob key: ${JSON.stringify(key)}`);
  }
}

export function uploadDir(): string {
  return path.resolve(process.env.UPLOAD_DIR ?? DEFAULT_UPLOAD_DIR);
}

function pathFor(key: string): string {
  assertSafeKey(key);
  return path.join(uploadDir(), key);
}

export const localDiskBlobStore: BlobStore = {
  async put(key, bytes) {
    const target = pathFor(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
  },

  async get(key) {
    const target = pathFor(key);
    // Node's createReadStream is lazy — a missing file surfaces as an 'error'
    // event during consumption, not here. Probing with stat() first would be a
    // TOCTOU race, so the error is translated on the stream instead.
    const nodeStream = createReadStream(target);
    return new ReadableStream<Uint8Array>({
      start(controller) {
        nodeStream.on("data", (chunk) =>
          controller.enqueue(typeof chunk === "string" ? Buffer.from(chunk) : chunk),
        );
        nodeStream.on("end", () => controller.close());
        nodeStream.on("error", (err: NodeJS.ErrnoException) => {
          controller.error(err.code === "ENOENT" ? new BlobNotFoundError(key) : err);
        });
      },
      cancel() {
        nodeStream.destroy();
      },
    });
  },

  async delete(key) {
    // force: true so deleting an already-absent blob is a no-op — the ingest
    // cleanup path runs on failures where the write may never have happened.
    await rm(pathFor(key), { force: true });
  },
};

/** Exported for tests that need to drain a store stream into memory. */
export async function readAll(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export { Readable };
