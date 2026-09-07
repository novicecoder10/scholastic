import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BlobNotFoundError } from "@/lib/storage/blobStore";
import { assertSafeKey, localDiskBlobStore, readAll } from "@/lib/storage/localDisk";

let dir: string;
const originalUploadDir = process.env.UPLOAD_DIR;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "scholastic-blob-"));
  process.env.UPLOAD_DIR = dir;
});

afterEach(async () => {
  if (originalUploadDir === undefined) delete process.env.UPLOAD_DIR;
  else process.env.UPLOAD_DIR = originalUploadDir;
  await rm(dir, { recursive: true, force: true });
});

describe("assertSafeKey", () => {
  it("accepts a base64url key of the shape we generate", () => {
    expect(() => assertSafeKey("aBc-123_XYZ")).not.toThrow();
  });

  it.each(["../etc/passwd", "a/b", "a\\b", ".", "..", "", "a.pdf", "a\0b"])(
    "rejects %j rather than trying to sanitise it",
    (key) => {
      expect(() => assertSafeKey(key)).toThrow(/Unsafe blob key/);
    },
  );
});

describe("localDiskBlobStore", () => {
  it("round-trips bytes", async () => {
    const bytes = Buffer.from("%PDF-1.7 hello");
    await localDiskBlobStore.put("abc123", bytes, "application/pdf");
    expect(await readAll(await localDiskBlobStore.get("abc123"))).toEqual(bytes);
  });

  it("creates the upload directory on first write", async () => {
    const nested = path.join(dir, "nested", "deeper");
    process.env.UPLOAD_DIR = nested;
    await localDiskBlobStore.put("k1", Buffer.from("x"), "application/pdf");
    expect(await readdir(nested)).toEqual(["k1"]);
  });

  it("surfaces a missing blob as BlobNotFoundError", async () => {
    const stream = await localDiskBlobStore.get("missingkey");
    await expect(readAll(stream)).rejects.toBeInstanceOf(BlobNotFoundError);
  });

  it("deletes a blob", async () => {
    await localDiskBlobStore.put("k2", Buffer.from("x"), "application/pdf");
    await localDiskBlobStore.delete("k2");
    await expect(readAll(await localDiskBlobStore.get("k2"))).rejects.toBeInstanceOf(
      BlobNotFoundError,
    );
  });

  it("treats deleting an absent blob as a no-op, so ingest cleanup is safe", async () => {
    await expect(localDiskBlobStore.delete("neverexisted")).resolves.toBeUndefined();
  });

  it("refuses to escape the upload directory", async () => {
    await expect(
      localDiskBlobStore.put("../escaped", Buffer.from("x"), "application/pdf"),
    ).rejects.toThrow(/Unsafe blob key/);
  });
});
