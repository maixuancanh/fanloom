import { createHash } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const MAX_SIGNED_URL_TTL_SECONDS = 900;

export type ArtifactStoreConfig = {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  maxBytes?: number;
};

export type ArtifactPutOptions = {
  contentType: string;
  checksumSha256?: string;
};

function normalizedKeySegments(key: string): string[] {
  if (
    typeof key !== "string" ||
    key.length === 0 ||
    key.includes("\\") ||
    /%(?:2f|5c|2e)/i.test(key)
  ) {
    throw new Error("artifact_scope_violation");
  }

  const segments = key.split("/");
  const unsafeSegments = new Set([".", [".", "."].join("")]);
  if (segments.some((segment) => segment.length === 0 || unsafeSegments.has(segment))) {
    throw new Error("artifact_scope_violation");
  }
  return segments;
}

function requireCreatorPrefix(key: string, creatorId: string): void {
  const segments = normalizedKeySegments(key);
  if (!creatorId || normalizedKeySegments(creatorId).length !== 1 || segments[0] !== creatorId || segments.length < 2) {
    throw new Error("artifact_scope_violation");
  }
}

function validateContentType(contentType: string): void {
  if (!contentType || !/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/.test(contentType)) {
    throw new Error("artifact_content_type_invalid");
  }
}

export class ArtifactStore {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly maxBytes: number;

  constructor(config: ArtifactStoreConfig = {
    endpoint: process.env.S3_ENDPOINT ?? "",
    bucket: process.env.S3_BUCKET ?? "",
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
  }) {
    if (!config.endpoint || !config.bucket || !config.accessKeyId || !config.secretAccessKey) {
      throw new Error("fanloom_storage_configuration_missing");
    }
    this.bucket = config.bucket;
    this.maxBytes = config.maxBytes ?? DEFAULT_MAX_BYTES;
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: "us-east-1",
      forcePathStyle: true,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }

  async put(key: string, body: Uint8Array, creatorId: string, options: ArtifactPutOptions): Promise<{ sha256: string; byteSize: number }> {
    requireCreatorPrefix(key, creatorId);
    validateContentType(options.contentType);
    if (body.byteLength === 0 || body.byteLength > this.maxBytes) throw new Error("artifact_size_invalid");
    const sha256 = createHash("sha256").update(body).digest("hex");
    if (options.checksumSha256 && options.checksumSha256 !== sha256) throw new Error("artifact_checksum_mismatch");
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: options.contentType,
      ChecksumSHA256: Buffer.from(sha256, "hex").toString("base64"),
    }));
    return { sha256, byteSize: body.byteLength };
  }

  async signedReadUrl(key: string, creatorId: string, expiresInSeconds = 300): Promise<string> {
    requireCreatorPrefix(key, creatorId);
    if (!Number.isInteger(expiresInSeconds) || expiresInSeconds < 1 || expiresInSeconds > MAX_SIGNED_URL_TTL_SECONDS) {
      throw new Error("artifact_ttl_invalid");
    }
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: expiresInSeconds });
  }

  async delete(key: string, creatorId: string): Promise<void> {
    requireCreatorPrefix(key, creatorId);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
