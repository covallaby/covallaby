import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
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
  get(key: string, range?: { start: number; end: number }): Promise<Uint8Array>;
  exists(key: string, expectedSize: number): Promise<boolean>;
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

  async get(key: string, range?: { start: number; end: number }): Promise<Uint8Array> {
    const bytes = await readFile(this.path(key));
    return range ? bytes.subarray(range.start, range.end + 1) : bytes;
  }

  async exists(key: string, expectedSize: number): Promise<boolean> {
    try {
      return (await stat(this.path(key))).size === expectedSize;
    } catch {
      return false;
    }
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
}

export function openArtifactStorage(env: NodeJS.ProcessEnv = process.env): ArtifactStorage {
  const bucket = env.COVALLABY_ARTIFACT_BUCKET?.trim() || env.BUCKET_NAME?.trim();
  return bucket
    ? new S3ArtifactStorage(bucket, env)
    : new LocalArtifactStorage(env.COVALLABY_ARTIFACTS_DIR || "data/artifacts");
}
