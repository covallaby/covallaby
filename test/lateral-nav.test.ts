import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { ArtifactStorage } from "../src/artifacts.js";
import { SqliteStore } from "../src/store/sqlite.js";

/**
 * Lateral prev/next/base navigation (COV-15): every evidence detail endpoint
 * carries `neighbors` so the dashboard can jump sideways through history, and
 * upload detail carries the resolved base upload for the "Base build" link.
 */

const lcov = `SF:src/a.ts
DA:1,5
DA:2,0
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

describe("upload detail lateral navigation", () => {
  const store = new SqliteStore(":memory:");
  const app = createApp({ store, uploadToken: "sekret" });
  const ids: number[] = [];
  let prId = 0;
  const baseSha = "b".repeat(40);

  const upload = (query: string) =>
    app.request(`/api/v1/upload?${query}`, {
      method: "POST",
      headers: { authorization: "Bearer sekret" },
      body: lcov,
    });

  beforeAll(async () => {
    for (const commit of ["m1", "m2", baseSha]) {
      const json = await (await upload(`repo=acme/app&branch=main&commit=${commit}`)).json();
      ids.push(json.id);
    }
    const pr = await (
      await upload(`repo=acme/app&branch=feat/x&commit=headsha1&pr=7&base-sha=${baseSha}`)
    ).json();
    prId = pr.id;
  });

  it("returns prev/next on the same branch, null at the ends", async () => {
    const mid = await (await app.request(`/api/v1/uploads/${ids[1]}`)).json();
    expect(mid.neighbors.prev.commit).toBe("m1");
    expect(mid.neighbors.next.commit).toBe(baseSha);
    // Neighbor rows are navigation payloads, not report dumps.
    expect(mid.neighbors.prev.report).toBeUndefined();

    const first = await (await app.request(`/api/v1/uploads/${ids[0]}`)).json();
    expect(first.neighbors.prev).toBeNull();
    expect(first.neighbors.next.commit).toBe("m2");

    const last = await (await app.request(`/api/v1/uploads/${ids[2]}`)).json();
    expect(last.neighbors.prev.commit).toBe("m2");
    expect(last.neighbors.next).toBeNull();
  });

  it("stays inside the upload's own branch", async () => {
    const pr = await (await app.request(`/api/v1/uploads/${prId}`)).json();
    expect(pr.neighbors).toEqual({ prev: null, next: null }); // only upload on feat/x
  });

  it("resolves the base upload for PR uploads (the Base build link)", async () => {
    const pr = await (await app.request(`/api/v1/uploads/${prId}`)).json();
    expect(pr.baseUpload.id).toBe(ids[2]);
    expect(pr.baseUpload.commit).toBe(baseSha);
    expect(pr.baseline.reason).toBe("base-sha");
  });
});

describe("visual run lateral navigation", () => {
  const store = new SqliteStore(":memory:");
  const app = createApp({
    store,
    uploadToken: "sekret",
    artifactStorage: new MemoryArtifacts(),
    storybookPreviewBaseUrl: "https://previews.test",
    storybookPreviewSecret: "preview-secret",
  });
  const runs: Record<string, number> = {};

  beforeAll(async () => {
    for (const [key, framework, commit] of [
      ["play1", "playwright", "p1"],
      ["story1", "storybook", "s1"],
      ["play2", "playwright", "p2"],
      ["story2", "storybook", "s2"],
    ] as const) {
      const run = await store.createTestRun!({
        repo: "acme/app",
        branch: "main",
        commit,
        pr: null,
        framework,
        testsPassed: 1,
        testsFailed: 0,
        testsSkipped: 0,
        durationMs: 10,
      });
      await store.completeTestRun!(run.id);
      runs[key] = run.id;
    }
  });

  it("serves Playwright run neighbors within the framework", async () => {
    const first = await (await app.request(`/api/v1/test-runs/${runs.play1}`)).json();
    expect(first.neighbors.prev).toBeNull();
    expect(first.neighbors.next.commit).toBe("p2"); // skips the storybook run between

    const second = await (await app.request(`/api/v1/test-runs/${runs.play2}`)).json();
    expect(second.neighbors.prev.commit).toBe("p1");
    expect(second.neighbors.next).toBeNull();
  });

  it("serves Storybook preview neighbors within the framework", async () => {
    const first = await (await app.request(`/api/v1/storybook-previews/${runs.story1}`)).json();
    expect(first.neighbors.prev).toBeNull();
    expect(first.neighbors.next.commit).toBe("s2");

    const second = await (await app.request(`/api/v1/storybook-previews/${runs.story2}`)).json();
    expect(second.neighbors.prev.commit).toBe("s1");
    expect(second.neighbors.next).toBeNull();
  });
});
