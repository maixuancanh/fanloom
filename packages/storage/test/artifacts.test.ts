import { createHash } from "node:crypto";
import { join } from "node:path";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import S3rver from "s3rver";
import { ArtifactStore } from "../src/artifacts.js";

const port = 4569;
const bucket = "fanloom-artifacts";
const bytes = Buffer.from("real artifact bytes");
let server: S3rver;
let store: ArtifactStore;

beforeAll(async () => {
  server = new S3rver({
    port,
    address: "127.0.0.1",
    silent: true,
    allowMismatchedSignatures: true,
    directory: join(process.cwd(), ".s3rver-test-data"),
    resetOnClose: true,
    configureBuckets: [{ name: bucket, configs: [] }],
  });
  await server.run();
  const endpoint = "http:" + "//127.0.0.1:" + port;
  store = new ArtifactStore({ endpoint, bucket, accessKeyId: "S3RVER", secretAccessKey: "S3RVER" });
});

afterAll(async () => {
  await server.close();
});

describe("ArtifactStore", () => {
  it("stores and signs a creator-scoped artifact with its checksum and size", async () => {
    const checksum = createHash("sha256").update(bytes).digest("hex");
    await expect(store.put("creator-1/file.png", bytes, "creator-1", { contentType: "image/png", checksumSha256: checksum })).resolves.toEqual({ sha256: checksum, byteSize: bytes.byteLength });
    await expect(store.signedReadUrl("creator-1/file.png", "creator-1", 60)).resolves.toContain("/creator-1/file.png?");
    await expect(store.delete("creator-1/file.png", "creator-1")).resolves.toBeUndefined();
  });

  it("rejects scope, checksum, content type, size, and TTL violations", async () => {
    await expect(store.put("other-creator/file.png", bytes, "creator-1", { contentType: "image/png" })).rejects.toThrow("artifact_scope_violation");
    await expect(store.put("creator-1/file.png", bytes, "creator-1", { contentType: "image/png", checksumSha256: "0".repeat(64) })).rejects.toThrow("artifact_checksum_mismatch");
    await expect(store.put("creator-1/file.png", bytes, "creator-1", { contentType: "invalid" })).rejects.toThrow("artifact_content_type_invalid");
    await expect(store.put("creator-1/file.png", Buffer.alloc(0), "creator-1", { contentType: "image/png" })).rejects.toThrow("artifact_size_invalid");
    await expect(store.signedReadUrl("creator-1/file.png", "creator-1", 901)).rejects.toThrow("artifact_ttl_invalid");
  });

  it("rejects traversal, empty, and alternate-separator keys for every operation", async () => {
    const invalidKeys = [
      "creator-1/../other/file.png",
      "creator-1/./file.png",
      "creator-1//file.png",
      "creator-1/",
      "creator-1\\other\\file.png",
      "creator-1/%2e%2e/other/file.png",
      "creator-1/%2Fother/file.png",
    ];

    for (const key of invalidKeys) {
      await expect(store.put(key, bytes, "creator-1", { contentType: "image/png" })).rejects.toThrow("artifact_scope_violation");
      await expect(store.signedReadUrl(key, "creator-1")).rejects.toThrow("artifact_scope_violation");
      await expect(store.delete(key, "creator-1")).rejects.toThrow("artifact_scope_violation");
    }
  });
});
