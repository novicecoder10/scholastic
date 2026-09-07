import { localDiskBlobStore } from "@/lib/storage/localDisk";
import type { BlobStore } from "@/lib/storage/blobStore";

/**
 * Single selection point, mirroring `getActiveEmbeddingProvider()` and
 * `getActiveLlmProvider()`. Only one implementation exists today; the seam is
 * here so adding a hosted store later touches this file alone.
 */
export function getBlobStore(): BlobStore {
  return localDiskBlobStore;
}

export type { BlobStore } from "@/lib/storage/blobStore";
export { BlobNotFoundError } from "@/lib/storage/blobStore";
