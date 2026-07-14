import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { ArtifactStorage } from "../src/artifacts.js";
import { SqliteStore } from "../src/store/sqlite.js";
import type { UploadRow } from "../web/src/api.js";
import { commitHref } from "../web/src/components/commit-strip.js";

const lcov = `SF:src/a.ts
DA:1,5
DA:2,0
DA:3,5
end_of_record
`;

class MemoryArtifacts implements ArtifactStorage {
  readonly kind = "local" as const;
  objects = new Map<string, Uint8Array>();
  async createUploadUrl() {
    return null;
  }
  async createDownloadUrl() {
    return null;
  }
  async put(key: string, body: Uint8Array) {
    this.objects.set(key, body);
  }
  async get(key: string, range?: { start: number; end: number }) {
    const bytes = this.objects.get(key)!;
    return range ? bytes.subarray(range.start, range.end + 1) : bytes;
  }
  async exists(key: string, size: number) {
    return this.objects.get(key)?.byteLength === size;
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
}

describe("GET /api/v1/repos/:owner/:name/commits/:sha", () => {
  const store = new SqliteStore(":memory:");
  const app = createApp({ store, uploadToken: "sekret", artifactStorage: new MemoryArtifacts() });
  const sha = "8f31cb8d59ea5bb8e8dcf7cd981bfc5fbdfa456a";
  const otherSha = "72d41f0dd8e6abfe280d9e340c277421f3607184";

  beforeAll(async () => {
    const upload = await app.request(
      `/api/v1/upload?repo=acme/app&branch=feature/x&commit=${sha}&pr=12`,
      { method: "POST", headers: { authorization: "Bearer sekret" }, body: lcov },
    );
    expect(upload.status).toBe(200);
    await store.createTestRun!({
      repo: "acme/app",
      branch: "feature/x",
      commit: sha,
      pr: 12,
      framework: "playwright",
      testsPassed: 3,
      testsFailed: 0,
      testsSkipped: 0,
      durationMs: 1000,
    });
    await store.createTestRun!({
      repo: "acme/app",
      branch: "feature/x",
      commit: sha,
      pr: 12,
      framework: "storybook",
      testsPassed: 0,
      testsFailed: 0,
      testsSkipped: 0,
      durationMs: 0,
    });
    // Noise on another SHA must not leak into the envelope.
    await store.createTestRun!({
      repo: "acme/app",
      branch: "main",
      commit: otherSha,
      pr: null,
      framework: "playwright",
      testsPassed: 1,
      testsFailed: 0,
      testsSkipped: 0,
      durationMs: 500,
    });
  });

  it("joins the upload, journey run, and component preview on one SHA", async () => {
    const res = await app.request(`/api/v1/repos/acme/app/commits/${sha}`);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.commit).toBe(sha);
    expect(json.upload?.commit).toBe(sha);
    expect(json.upload?.pr).toBe(12);
    expect(json.run?.framework).toBe("playwright");
    expect(json.run?.commit).toBe(sha);
    expect(json.preview?.framework).toBe("storybook");
    expect(json.preview?.commit).toBe(sha);
  });

  it("returns nulls for a SHA with no artifacts", async () => {
    const json = await (await app.request("/api/v1/repos/acme/app/commits/cafef00d")).json();
    expect(json).toEqual({ commit: "cafef00d", upload: null, run: null, preview: null });
  });

  it("does not join across repositories", async () => {
    const json = await (await app.request(`/api/v1/repos/acme/other/commits/${sha}`)).json();
    expect(json.upload).toBeNull();
    expect(json.run).toBeNull();
    expect(json.preview).toBeNull();
  });

  it("rejects an oversized SHA", async () => {
    const res = await app.request(`/api/v1/repos/acme/app/commits/${"a".repeat(65)}`);
    expect(res.status).toBe(400);
  });

  it("still resolves the coverage upload when artifact storage is off", async () => {
    const bare = createApp({ store, uploadToken: "sekret" });
    const json = await (await bare.request(`/api/v1/repos/acme/app/commits/${sha}`)).json();
    expect(json.upload?.commit).toBe(sha);
    expect(json.run).toBeNull();
    expect(json.preview).toBeNull();
  });
});

describe("commitHref", () => {
  const upload = { id: 7, commit: "abc123def456" } as UploadRow;

  it("links to the upload page when the SHA has a coverage upload", () => {
    expect(commitHref("acme/app", "abc123def456", [upload])).toBe("/r/acme/app/u/7");
  });

  it("falls back to the commits page otherwise", () => {
    expect(commitHref("acme/app", "feedbead", [upload])).toBe("/r/acme/app/commits");
    expect(commitHref("acme/app", "feedbead", undefined)).toBe("/r/acme/app/commits");
  });
});
