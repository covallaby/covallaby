import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface ArtifactStorage {
  readonly kind: "local" | "s3";
  createUploadUrl(key: string, contentType: string): Promise<string | null>;
  createDownloadUrl(key: string): Promise<string | null>;
  put(key: string, body: Uint8Array): Promise<void>;
  putStream?(key: string, body: ReadableStream<Uint8Array>, expectedSize: number): Promise<boolean>;
  get(key: string, range?: { start: number; end: number }): Promise<Uint8Array>;
  exists(key: string, expectedSize: number): Promise<boolean>;
  delete(key: string): Promise<void>;
}

export function artifactObjectKey(repo: string, runId: number, name: string): string {
  const safeRepo = repo.replace(/[^\w./-]/g, "_");
  const safeName = name.replace(/[^\w.-]/g, "_").slice(-160) || "artifact";
  return `repos/${safeRepo}/test-runs/${runId}/${randomUUID()}-${safeName}`;
}

export class LocalArtifactStorage implements ArtifactStorage {
  readonly kind = "local" as const;
  private readonly root: string;

  constructor(root = "data/artifacts") {
    this.root = resolve(root);
  }

  private path(key: string): string {
    const path = resolve(join(this.root, key));
    if (!path.startsWith(`${this.root}/`)) throw new Error("Invalid artifact key.");
    return path;
  }

  async createUploadUrl(): Promise<null> {
    return null;
  }
  async createDownloadUrl(): Promise<null> {
    return null;
  }

  async put(key: string, body: Uint8Array): Promise<void> {
    const path = this.path(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }

  async putStream(
    key: string,
    body: ReadableStream<Uint8Array>,
    expectedSize: number,
  ): Promise<boolean> {
    const path = this.path(key);
    await mkdir(dirname(path), { recursive: true });
    let received = 0;
    const count = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.byteLength;
        callback(
          received > expectedSize ? new Error("Artifact exceeds its declared size.") : null,
          chunk,
        );
      },
    });
    try {
      await pipeline(Readable.fromWeb(body), count, createWriteStream(path));
      if (received === expectedSize) return true;
    } catch (error) {
      await rm(path, { force: true });
      if (received > expectedSize) return false;
      throw error;
    }
    await rm(path, { force: true });
    return false;
  }

  async get(key: string, range?: { start: number; end: number }): Promise<Uint8Array> {
    const path = this.path(key);
    if (!range) return readFile(path);
    const length = range.end - range.start + 1;
    const bytes = Buffer.allocUnsafe(length);
    const file = await open(path, "r");
    try {
      const { bytesRead } = await file.read(bytes, 0, length, range.start);
      return bytes.subarray(0, bytesRead);
    } finally {
      await file.close();
    }
  }

  async exists(key: string, expectedSize: number): Promise<boolean> {
    try {
      return (await stat(this.path(key))).size === expectedSize;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }
}

export class S3ArtifactStorage implements ArtifactStorage {
  readonly kind = "s3" as const;
  private readonly client: S3Client;

  constructor(
    private readonly bucket: string,
    env: NodeJS.ProcessEnv = process.env,
  ) {
    this.client = new S3Client({
      region: env.AWS_REGION || "auto",
      ...(env.AWS_ENDPOINT_URL_S3 && { endpoint: env.AWS_ENDPOINT_URL_S3 }),
      forcePathStyle: /^(1|true)$/i.test(env.COVALLABY_S3_PATH_STYLE ?? ""),
    });
  }

  async createUploadUrl(key: string, contentType: string): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
      { expiresIn: 900 },
    );
  }

  async createDownloadUrl(key: string): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: 3600,
    });
  }

  async put(): Promise<void> {
    throw new Error("S3 artifacts must use the presigned upload URL.");
  }
  async get(): Promise<Uint8Array> {
    throw new Error("S3 artifacts must use the signed download URL.");
  }

  async exists(key: string, expectedSize: number): Promise<boolean> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return Number(result.ContentLength) === expectedSize;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

export function openArtifactStorage(env: NodeJS.ProcessEnv = process.env): ArtifactStorage {
  const bucket = env.COVALLABY_ARTIFACT_BUCKET?.trim() || env.BUCKET_NAME?.trim();
  return bucket
    ? new S3ArtifactStorage(bucket, env)
    : new LocalArtifactStorage(env.COVALLABY_ARTIFACTS_DIR || "data/artifacts");
}
