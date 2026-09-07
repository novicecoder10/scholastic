/**
 * The one contract the ingestion pipeline depends on for bytes. Local disk is
 * the default implementation; an S3/R2 adapter can be added later without any
 * caller changing, exactly as provider adapters work in `lib/providers/`.
 *
 * Keys are opaque, caller-generated strings. A store must never interpret one
 * as a filesystem path — see `localDisk.ts` for why that matters.
 */
export interface BlobStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<ReadableStream<Uint8Array>>;
  delete(key: string): Promise<void>;
}

export class BlobNotFoundError extends Error {
  constructor(key: string) {
    super(`No stored blob for key ${key}`);
    this.name = "BlobNotFoundError";
  }
}
