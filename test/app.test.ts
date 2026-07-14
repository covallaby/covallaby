import { PNG } from "pngjs";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp, ensureUploadToken } from "../src/app.js";
import type { ArtifactStorage } from "../src/artifacts.js";
import { attachDashboard } from "../src/static-node.js";
import { SqliteStore } from "../src/store/sqlite.js";

const lcov = `SF:src/a.ts
DA:1,5
DA:2,0
DA:3,5
end_of_record
`;

const store = new SqliteStore(":memory:");
const app = createApp({ store, uploadToken: "sekret" });
attachDashboard(app, "/nonexistent"); // Node runtime attaches the SPA catch-all

const upload = (query = "repo=acme/app&branch=main&commit=abc1234", token = "sekret") =>
  app.request(`/api/v1/upload?${query}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: lcov,
  });

describe("upload API", () => {
  it("rejects bad tokens and bad repos", async () => {
    expect((await upload(undefined, "wrong")).status).toBe(401);
    expect((await upload("repo=nope")).status).toBe(400);
  });

  it("accepts a coverage file and computes the summary", async () => {
    const res = await upload();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.percent).toBeCloseTo(66.66, 1);
    expect(json.url).toBe(`/r/acme/app/u/${json.id}`);
  });

  it("accepts commit-sha and base-sha CI overrides and validates their format", async () => {
    const head = "a".repeat(40);
    const base = "b".repeat(40);
    const ok = await upload(
      `repo=acme/overrides&branch=feat/squash&commit-sha=${head}&base-sha=${base}&pr=9`,
    );
    expect(ok.status).toBe(200);
    expect((await ok.json()).commit).toBe(head);

    expect((await upload("repo=acme/overrides&base-sha=not-hex")).status).toBe(400);
    expect((await upload("repo=acme/overrides&commit-sha=xyz")).status).toBe(400);
    expect((await upload(`repo=acme/overrides&base-sha=${"c".repeat(65)}`)).status).toBe(400);
  });

  it("gives a friendly 422 for unparseable bodies", async () => {
    const res = await app.request("/api/v1/upload?repo=acme/app", {
      method: "POST",
      headers: { authorization: "Bearer sekret" },
      body: "not a coverage file",
    });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("lcov");
  });
});

describe("browser test artifacts", () => {
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
  const artifactStore = new MemoryArtifacts();
  const artifactDb = new SqliteStore(":memory:");
  const artifactApp = createApp({
    store: artifactDb,
    uploadToken: "sekret",
    artifactStorage: artifactStore,
    storybookPreviewBaseUrl: "https://previews.test",
    storybookPreviewSecret: "preview-secret",
  });
  const manifest = {
    repo: "acme/app",
    branch: "feature/playback",
    commit: "feed123",
    pr: 8,
    framework: "playwright",
    testsPassed: 5,
    testsFailed: 1,
    testsSkipped: 2,
    durationMs: 4321,
    artifacts: [
      {
        name: "checkout.webm",
        kind: "video",
        contentType: "video/webm",
        sizeBytes: 4,
        testName: "checkout › buys a plan",
      },
      {
        name: "trace.zip",
        kind: "trace",
        contentType: "application/zip",
        sizeBytes: 4,
        testName: "checkout › buys a plan",
      },
    ],
  };

  it("authenticates and validates run manifests", async () => {
    const denied = await artifactApp.request("/api/v1/test-runs", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer wrong" },
      body: JSON.stringify(manifest),
    });
    expect(denied.status).toBe(401);
    const oversized = structuredClone(manifest);
    oversized.artifacts[0]!.sizeBytes = 501 * 1024 * 1024;
    const bad = await artifactApp.request("/api/v1/test-runs", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer sekret" },
      body: JSON.stringify(oversized),
    });
    expect(bad.status).toBe(400);
  });

  it("uploads, verifies, completes, lists, and plays a run", async () => {
    const created = await artifactApp.request("/api/v1/test-runs", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer sekret" },
      body: JSON.stringify(manifest),
    });
    expect(created.status).toBe(201);
    const data = await created.json();
    expect(data.run.testsPassed).toBe(5);
    expect(data.artifacts[0].objectKey).toBeUndefined();

    const early = await artifactApp.request(`/api/v1/test-runs/${data.run.id}/complete`, {
      method: "POST",
      headers: { authorization: "Bearer sekret" },
    });
    expect(early.status).toBe(409);

    for (const artifact of data.artifacts) {
      const uploaded = await artifactApp.request(new URL(artifact.uploadUrl).pathname, {
        method: "PUT",
        headers: { authorization: "Bearer sekret", "content-type": artifact.contentType },
        body: "1234",
      });
      expect(uploaded.status).toBe(200);
    }
    const completed = await artifactApp.request(`/api/v1/test-runs/${data.run.id}/complete`, {
      method: "POST",
      headers: { authorization: "Bearer sekret" },
    });
    expect(completed.status).toBe(200);

    const listed = await (await artifactApp.request("/api/v1/repos/acme/app/test-runs")).json();
    expect(listed.runs[0].status).toBe("complete");
    const detail = await (await artifactApp.request(`/api/v1/test-runs/${data.run.id}`)).json();
    expect(detail.artifacts[0].testName).toContain("checkout");
    const trace = detail.artifacts.find((artifact: { kind: string }) => artifact.kind === "trace");
    const viewer = new URL(trace.viewerUrl);
    expect(viewer.origin).toBe("https://trace.playwright.dev");
    const traceSource = viewer.searchParams.get("trace")!;
    const traceResponse = await artifactApp.request(traceSource);
    expect(traceResponse.status).toBe(200);
    expect(traceResponse.headers.get("access-control-allow-origin")).toBe(
      "https://trace.playwright.dev",
    );
    expect(await traceResponse.text()).toBe("1234");
    const media = await artifactApp.request(detail.artifacts[0].url);
    expect(media.headers.get("content-type")).toContain("video/webm");
    expect(await media.text()).toBe("1234");
    const ranged = await artifactApp.request(detail.artifacts[0].url, {
      headers: { range: "bytes=1-2" },
    });
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get("content-range")).toBe("bytes 1-2/4");
    expect(await ranged.text()).toBe("23");
    const invalidRange = await artifactApp.request(detail.artifacts[0].url, {
      headers: { range: "not-a-range" },
    });
    expect(invalidRange.status).toBe(416);
    expect(invalidRange.headers.get("content-range")).toBe("bytes */4");
  });

  it("hosts a complete Storybook build on the isolated preview origin", async () => {
    const manifest = {
      repo: "acme/app",
      branch: "feature/components",
      commit: "decaf42",
      pr: 12,
      files: [
        { path: "index.html", contentType: "text/html", sizeBytes: 30 },
        { path: "assets/app.js", contentType: "text/javascript", sizeBytes: 17 },
        {
          path: "_covallaby/captures/button--primary.png",
          contentType: "image/png",
          sizeBytes: 4,
          kind: "screenshot",
          testName: JSON.stringify({
            id: "button--primary",
            title: "Components/Button",
            name: "Primary",
          }),
        },
      ],
    };
    const created = await artifactApp.request("/api/v1/storybook-previews", {
      method: "POST",
      headers: { authorization: "Bearer sekret", "content-type": "application/json" },
      body: JSON.stringify(manifest),
    });
    expect(created.status).toBe(201);
    const data = await created.json();
    const bodies = ["<h1>Component library</h1>okay", "console.log('hi')", "png!"];
    for (const [index, artifact] of data.artifacts.entries()) {
      const uploaded = await artifactApp.request(new URL(artifact.uploadUrl).pathname, {
        method: "PUT",
        headers: { authorization: "Bearer sekret" },
        body: bodies[index],
      });
      expect(uploaded.status).toBe(200);
    }
    const completed = await artifactApp.request(
      `/api/v1/storybook-previews/${data.run.id}/complete`,
      { method: "POST", headers: { authorization: "Bearer sekret" } },
    );
    expect(completed.status).toBe(200);

    const browserRuns = await (
      await artifactApp.request("/api/v1/repos/acme/app/test-runs")
    ).json();
    expect(
      browserRuns.runs.every((run: { framework: string }) => run.framework === "playwright"),
    ).toBe(true);
    expect((await artifactApp.request(`/api/v1/test-runs/${data.run.id}`)).status).toBe(404);
    const previews = await (
      await artifactApp.request("/api/v1/repos/acme/app/storybook-previews")
    ).json();
    expect(previews.previews).toHaveLength(1);
    expect(previews.previews[0].framework).toBe("storybook");
    expect(previews.previews[0]).toMatchObject({ imageCount: 1 });
    const reviewSignals = await (
      await artifactApp.request("/api/v1/review-signals?repo=acme/app")
    ).json();
    expect(reviewSignals.repositories[0]).toMatchObject({
      repo: "acme/app",
      previews: [{ imageCount: 1 }],
    });

    const detail = await (
      await artifactApp.request(`/api/v1/storybook-previews/${data.run.id}`)
    ).json();
    expect(detail.previewUrl).toMatch(
      new RegExp(`^https://previews\\.test/p/${data.run.id}/index\\.html\\?preview_token=`),
    );
    expect(detail.captures).toEqual([
      expect.objectContaining({
        id: "button--primary",
        title: "Components/Button",
        name: "Primary",
        imageUrl: expect.stringContaining("/_covallaby/captures/button--primary.png"),
      }),
    ]);
    const tokenExchange = await artifactApp.request(detail.previewUrl);
    expect(tokenExchange.status).toBe(302);
    expect(tokenExchange.headers.get("location")).toBe(`/p/${data.run.id}/index.html`);
    expect(tokenExchange.headers.get("location")).not.toContain("preview_token");
    expect(tokenExchange.headers.get("set-cookie")).toContain("SameSite=None; Secure");
    const cookie = tokenExchange.headers.get("set-cookie")!.split(";")[0]!;
    const index = await artifactApp.request(`https://previews.test/p/${data.run.id}/index.html`, {
      headers: { cookie },
    });
    expect(index.status).toBe(200);
    expect(index.headers.get("content-type")).toContain("text/html");
    expect(index.headers.get("cache-control")).toBe("private, no-store");
    expect(await index.text()).toContain("Component library");
    const asset = await artifactApp.request(
      `https://previews.test/p/${data.run.id}/assets/app.js`,
      { headers: { cookie } },
    );
    expect(await asset.text()).toBe("console.log('hi')");
    expect(asset.headers.get("cache-control")).toBe("private, max-age=3600");
    const proxied = await artifactApp.request(
      `http://internal-service/p/${data.run.id}/assets/app.js`,
      { headers: { cookie, host: "previews.test" } },
    );
    expect(proxied.status).toBe(200);
    expect(
      (
        await artifactApp.request(
          `http://localhost/p/${data.run.id}/index.html?preview_token=not-relevant`,
        )
      ).status,
    ).toBe(404);
  });

  it("compares a PR capture set to the preceding main run and serves pixel diffs", async () => {
    const png = (red: number) => {
      const image = new PNG({ width: 2, height: 2 });
      for (let index = 0; index < image.data.length; index += 4) {
        image.data.set([red, 20, 30, 255], index);
      }
      return PNG.sync.write(image);
    };
    const uploadPreview = async (
      branch: string,
      commit: string,
      pr: number | null,
      stories: Array<{ id: string; hash: string; bytes: Uint8Array }>,
    ) => {
      const files = [
        { path: "index.html", contentType: "text/html", sizeBytes: 4 },
        ...stories.map((story) => ({
          path: `_covallaby/captures/${story.id}.png`,
          contentType: "image/png",
          sizeBytes: story.bytes.byteLength,
          kind: "screenshot",
          testName: JSON.stringify({
            id: story.id,
            title: "Components/Button",
            name: story.id.split("--")[1],
            sha256: story.hash,
          }),
        })),
      ];
      const response = await artifactApp.request("/api/v1/storybook-previews", {
        method: "POST",
        headers: { authorization: "Bearer sekret", "content-type": "application/json" },
        body: JSON.stringify({ repo: "acme/diffs", branch, commit, pr, files }),
      });
      const created = await response.json();
      const bodies = [Buffer.from("home"), ...stories.map((story) => story.bytes)];
      for (const [index, artifact] of created.artifacts.entries()) {
        expect(
          (
            await artifactApp.request(new URL(artifact.uploadUrl).pathname, {
              method: "PUT",
              headers: { authorization: "Bearer sekret" },
              body: bodies[index],
            })
          ).status,
        ).toBe(200);
      }
      expect(
        (
          await artifactApp.request(`/api/v1/storybook-previews/${created.run.id}/complete`, {
            method: "POST",
            headers: { authorization: "Bearer sekret" },
          })
        ).status,
      ).toBe(200);
      return created.run.id as number;
    };

    const dark = png(10);
    const light = png(240);
    await uploadPreview("main", "base123", null, [
      { id: "button--primary", hash: "a".repeat(64), bytes: dark },
      { id: "button--removed", hash: "b".repeat(64), bytes: dark },
    ]);
    const currentId = await uploadPreview("feature/buttons", "head123", 42, [
      { id: "button--primary", hash: "c".repeat(64), bytes: light },
      { id: "button--new", hash: "d".repeat(64), bytes: dark },
    ]);

    const detail = await (
      await artifactApp.request(`/api/v1/storybook-previews/${currentId}`)
    ).json();
    expect(detail.baselineRun).toMatchObject({ branch: "main", commit: "base123" });
    expect(detail.summary).toEqual({ changed: 1, new: 1, removed: 1, unchanged: 0, uncompared: 0 });
    expect(detail.captures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "button--primary",
          status: "changed",
          diffImageUrl: expect.any(String),
          sha256: "c".repeat(64),
          baselineSha256: "a".repeat(64),
        }),
        expect.objectContaining({ id: "button--new", status: "new", sha256: "d".repeat(64) }),
        expect.objectContaining({
          id: "button--removed",
          status: "removed",
          artifactId: null,
          baselineSha256: "b".repeat(64),
        }),
      ]),
    );

    const changed = detail.captures.find(
      (capture: { status: string }) => capture.status === "changed",
    );
    const exchange = await artifactApp.request(changed.diffImageUrl);
    expect(exchange.status).toBe(302);
    const diff = await artifactApp.request(
      `https://previews.test${exchange.headers.get("location")}`,
      {
        headers: { cookie: exchange.headers.get("set-cookie")!.split(";")[0]! },
      },
    );
    expect(diff.status).toBe(200);
    expect(diff.headers.get("content-type")).toBe("image/png");
    expect(Number(diff.headers.get("x-covallaby-changed-pixels"))).toBeGreaterThan(0);
    expect(PNG.sync.read(Buffer.from(await diff.arrayBuffer()))).toMatchObject({
      width: 2,
      height: 2,
    });
  });

  it("auto-accepts default-branch capture runs and honors human review verdicts", async () => {
    // From the diff test above: acme/diffs has a main run and a PR run.
    const previews = await (
      await artifactApp.request("/api/v1/repos/acme/diffs/storybook-previews")
    ).json();
    const mainRun = previews.previews.find((p: { branch: string }) => p.branch === "main");
    const featureRun = previews.previews.find((p: { branch: string }) => p.branch !== "main");
    expect(mainRun.reviewState).toBe("auto-accepted"); // mainline never needs review
    expect(featureRun.reviewState).toBe("pending");

    const detail = await (
      await artifactApp.request(`/api/v1/storybook-previews/${featureRun.id}`)
    ).json();
    expect(detail.baseline).toMatchObject({
      reason: "latest-on-base",
      commit: "base123",
      baseBranch: "main",
    });
    expect(detail.baseline.message).toContain("latest on main");

    const review = (id: number, state: string, token = "sekret") =>
      artifactApp.request(`/api/v1/storybook-previews/${id}/review`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ state }),
      });
    expect((await review(mainRun.id, "rejected", "wrong")).status).toBe(401);
    expect((await review(mainRun.id, "auto-accepted")).status).toBe(400); // server-assigned only

    // Rejecting the main run removes it from baseline eligibility.
    const rejected = await review(mainRun.id, "rejected");
    expect(rejected.status).toBe(200);
    expect((await rejected.json()).run.reviewState).toBe("rejected");
    const orphaned = await (
      await artifactApp.request(`/api/v1/storybook-previews/${featureRun.id}`)
    ).json();
    expect(orphaned.baselineRun).toBeNull();
    expect(orphaned.baseline.reason).toBe("base-branch-empty");
    expect(orphaned.baseline.message).toContain("No baseline");
    expect(orphaned.captures.every((c: { status: string }) => c.status === "uncompared")).toBe(
      true,
    );

    // A human approval restores it.
    expect((await review(mainRun.id, "approved")).status).toBe(200);
    const restored = await (
      await artifactApp.request(`/api/v1/storybook-previews/${featureRun.id}`)
    ).json();
    expect(restored.baselineRun.commit).toBe("base123");
  });

  it("runs the per-story review loop: verdicts, derived run state, carry-over, stale reset", async () => {
    const png = (red: number) => {
      const image = new PNG({ width: 2, height: 2 });
      for (let index = 0; index < image.data.length; index += 4) {
        image.data.set([red, 20, 30, 255], index);
      }
      return PNG.sync.write(image);
    };
    const uploadPreview = async (
      branch: string,
      commit: string,
      stories: Array<{ id: string; hash: string; bytes: Uint8Array }>,
    ) => {
      const files = [
        { path: "index.html", contentType: "text/html", sizeBytes: 4 },
        ...stories.map((story) => ({
          path: `_covallaby/captures/${story.id}.png`,
          contentType: "image/png",
          sizeBytes: story.bytes.byteLength,
          kind: "screenshot",
          testName: JSON.stringify({
            id: story.id,
            title: "Components/Button",
            name: story.id.split("--")[1],
            sha256: story.hash,
          }),
        })),
      ];
      const created = await (
        await artifactApp.request("/api/v1/storybook-previews", {
          method: "POST",
          headers: { authorization: "Bearer sekret", "content-type": "application/json" },
          body: JSON.stringify({ repo: "acme/loop", branch, commit, pr: null, files }),
        })
      ).json();
      const bodies = [Buffer.from("home"), ...stories.map((story) => story.bytes)];
      for (const [index, artifact] of created.artifacts.entries()) {
        await artifactApp.request(new URL(artifact.uploadUrl).pathname, {
          method: "PUT",
          headers: { authorization: "Bearer sekret" },
          body: bodies[index],
        });
      }
      await artifactApp.request(`/api/v1/storybook-previews/${created.run.id}/complete`, {
        method: "POST",
        headers: { authorization: "Bearer sekret" },
      });
      return created.run.id as number;
    };
    const review = (id: number, stories: string[], state: string, headers = {}) =>
      artifactApp.request(`/api/v1/storybook-previews/${id}/review-captures`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ stories, state }),
      });
    const detailOf = async (id: number) =>
      (await artifactApp.request(`/api/v1/storybook-previews/${id}`)).json();
    const reviewOf = (detail: { captures: Array<{ id: string; review?: unknown }> }, id: string) =>
      detail.captures.find((capture) => capture.id === id)?.review as
        | { state: string; reviewedBy?: string | null; carried?: boolean }
        | undefined;

    const dark = png(10);
    const light = png(240);
    const hash = (letter: string) => letter.repeat(64);
    const mainId = await uploadPreview("main", "loopbase1", [
      { id: "button--one", hash: hash("a"), bytes: dark },
      { id: "button--two", hash: hash("a"), bytes: dark },
      { id: "button--gone", hash: hash("b"), bytes: dark },
    ]);
    const firstId = await uploadPreview("feat/loop", "loophead1", [
      { id: "button--one", hash: hash("c"), bytes: light },
      { id: "button--two", hash: hash("c"), bytes: light },
      { id: "button--fresh", hash: hash("d"), bytes: dark },
    ]);

    // Every reviewable capture starts pending; the run is pending.
    const initial = await detailOf(firstId);
    expect(initial.run.reviewState).toBe("pending");
    expect(reviewOf(initial, "button--one")).toEqual({ state: "pending" });
    expect(reviewOf(initial, "button--gone")).toEqual({ state: "pending" });
    expect(reviewOf(initial, "button--fresh")).toEqual({ state: "pending" });

    // Auth: a presented-but-wrong token always fails; auto-accepted mainline
    // is read-only; unknown stories and states are rejected.
    expect(
      (await review(firstId, ["button--one"], "approved", { authorization: "Bearer nope" })).status,
    ).toBe(401);
    expect((await review(mainId, ["button--one"], "approved")).status).toBe(409);
    expect((await review(firstId, ["button--unknown"], "approved")).status).toBe(400);
    expect((await review(firstId, ["button--one"], "sideways")).status).toBe(400);

    // A group approval is one call covering both members (identical diff).
    // With no view token and no hosted tier, the self-hosted server accepts
    // browser reviews without credentials (single-operator tool).
    const grouped = await (
      await review(firstId, ["button--one", "button--two"], "approved")
    ).json();
    expect(reviewOf(grouped, "button--one")).toMatchObject({ state: "approved" });
    expect(reviewOf(grouped, "button--two")).toMatchObject({ state: "approved" });
    expect(grouped.run.reviewState).toBe("pending"); // fresh + gone still pending

    // Rejecting any story rejects the run; approving everything approves it.
    const rejected = await (await review(firstId, ["button--fresh"], "rejected")).json();
    expect(rejected.run.reviewState).toBe("rejected");
    const reset = await (await review(firstId, ["button--fresh"], "pending")).json();
    expect(reset.run.reviewState).toBe("pending");
    await review(firstId, ["button--fresh"], "approved");
    const approved = await (await review(firstId, ["button--gone"], "approved")).json();
    expect(approved.run.reviewState).toBe("approved");

    // Carry-over: a later run with the identical (baseline, current) pairs
    // inherits the approvals at read time.
    const secondId = await uploadPreview("feat/loop", "loophead2", [
      { id: "button--one", hash: hash("c"), bytes: light },
      { id: "button--two", hash: hash("c"), bytes: light },
      { id: "button--fresh", hash: hash("d"), bytes: dark },
    ]);
    const carried = await detailOf(secondId);
    expect(reviewOf(carried, "button--one")).toMatchObject({ state: "approved", carried: true });
    expect(reviewOf(carried, "button--fresh")).toMatchObject({ state: "approved", carried: true });
    // The stored run state only re-derives on a write; one touch approves it.
    expect(carried.run.reviewState).toBe("pending");
    const touched = await (await review(secondId, ["button--one"], "approved")).json();
    expect(touched.run.reviewState).toBe("approved");

    // A different diff hash resets the story to pending automatically.
    const thirdId = await uploadPreview("feat/loop", "loophead3", [
      { id: "button--one", hash: hash("e"), bytes: dark },
      { id: "button--two", hash: hash("c"), bytes: light },
      { id: "button--fresh", hash: hash("d"), bytes: dark },
    ]);
    const stale = await detailOf(thirdId);
    expect(reviewOf(stale, "button--one")).toEqual({ state: "pending" });
    expect(reviewOf(stale, "button--two")).toMatchObject({ state: "approved", carried: true });

    // A view-token-gated self-hosted server requires the token for reviews.
    const gatedApp = createApp({
      store: artifactDb,
      uploadToken: "sekret",
      viewToken: "peek",
      artifactStorage: artifactStore,
      storybookPreviewBaseUrl: "https://previews.test",
      storybookPreviewSecret: "preview-secret",
    });
    const gatedReview = (query: string) =>
      gatedApp.request(`/api/v1/storybook-previews/${thirdId}/review-captures${query}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stories: ["button--one"], state: "approved" }),
      });
    expect((await gatedReview("")).status).toBe(401);
    expect((await gatedReview("?token=peek")).status).toBe(200);
  });

  it("validates the CI-supplied baseSha on visual run manifests", async () => {
    const bad = await artifactApp.request("/api/v1/storybook-previews", {
      method: "POST",
      headers: { authorization: "Bearer sekret", "content-type": "application/json" },
      body: JSON.stringify({
        repo: "acme/app",
        baseSha: "not-a-sha",
        files: [{ path: "index.html", contentType: "text/html", sizeBytes: 1 }],
      }),
    });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toContain("baseSha");

    const badRun = await artifactApp.request("/api/v1/test-runs", {
      method: "POST",
      headers: { authorization: "Bearer sekret", "content-type": "application/json" },
      body: JSON.stringify({ ...manifest, baseSha: "nope" }),
    });
    expect(badRun.status).toBe(400);
  });

  it("rejects unsafe or incomplete Storybook manifests", async () => {
    const response = await artifactApp.request("/api/v1/storybook-previews", {
      method: "POST",
      headers: { authorization: "Bearer sekret", "content-type": "application/json" },
      body: JSON.stringify({
        repo: "acme/app",
        files: [{ path: "../index.html", contentType: "text/html", sizeBytes: 1 }],
      }),
    });
    expect(response.status).toBe(400);

    const badContentType = await artifactApp.request("/api/v1/storybook-previews", {
      method: "POST",
      headers: { authorization: "Bearer sekret", "content-type": "application/json" },
      body: JSON.stringify({
        repo: "acme/app",
        files: [{ path: "index.html", contentType: "text/html\r\nx-bad: yes", sizeBytes: 1 }],
      }),
    });
    expect(badContentType.status).toBe(400);
  });
});

describe("read API and badge", () => {
  beforeAll(async () => {
    await upload("repo=acme/app&branch=main&commit=def5678");
  });

  it("lists repos with trends", async () => {
    const json = await (await app.request("/api/v1/repos")).json();
    const repo = json.repos.find((r: { repo: string }) => r.repo === "acme/app");
    expect(repo.latest.commit).toBe("def5678");
    expect(repo.trend.length).toBeGreaterThanOrEqual(2);
  });

  it("serves history with branches", async () => {
    const json = await (await app.request("/api/v1/repos/acme/app/history")).json();
    expect(json.branch).toBe("main");
    expect(json.branches).toContain("main");
    expect(json.history[0].commit).toBe("def5678");
  });

  it("serves upload detail with directories and files", async () => {
    const repos = await (await app.request("/api/v1/repos")).json();
    const id = repos.repos[0].latest.id;
    const json = await (await app.request(`/api/v1/uploads/${id}`)).json();
    expect(json.totals.lines.covered).toBe(2);
    expect(json.directories[0].path).toBe("src");
    expect(json.files[0].path).toBe("src/a.ts");
    expect(json.files[0].missing).toBe("2");
  });

  it("serves a live badge", async () => {
    const res = await app.request("/badge/acme/app.svg");
    expect(res.headers.get("content-type")).toContain("svg");
    expect(await res.text()).toContain("66.6%");
  });

  it("404s unknown repos and uploads", async () => {
    expect((await app.request("/api/v1/repos/acme/nope/history")).status).toBe(404);
    expect((await app.request("/api/v1/uploads/99999")).status).toBe(404);
  });

  it("answers dashboard routes with a pointer when the SPA isn't built", async () => {
    const res = await app.request("/r/acme/app");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("dashboard isn't built");
  });
});

describe("view token gate", () => {
  const gated = createApp({ store, uploadToken: "sekret", viewToken: "peek" });
  attachDashboard(gated, "/nonexistent");

  it("blocks pages without the token but allows health and upload", async () => {
    expect((await gated.request("/")).status).toBe(401);
    expect((await gated.request("/?token=peek")).status).toBe(200);
    expect((await gated.request("/healthz")).status).toBe(200);
  });

  it("does NOT leak upload detail past the gate (startsWith bug)", async () => {
    // /api/v1/uploads/:id must not be treated as the /api/v1/upload write route.
    expect((await gated.request("/api/v1/uploads/1")).status).toBe(401);
    expect((await gated.request("/api/v1/repos")).status).toBe(401);
  });

  it("survives a malformed view cookie without a 500", async () => {
    const res = await gated.request("/", { headers: { cookie: "covallaby_view=%" } });
    expect(res.status).toBe(401);
  });
});

describe("ensureUploadToken", () => {
  it("prefers the env token, else generates and persists one", async () => {
    const s = new SqliteStore(":memory:");
    expect(await ensureUploadToken(s, "from-env")).toBe("from-env");
    const generated = await ensureUploadToken(s, undefined);
    expect(generated.length).toBeGreaterThan(20);
    expect(await ensureUploadToken(s, undefined)).toBe(generated); // stable across boots
    await s.close();
  });
});

describe("per-repo tokens and rate limiting", () => {
  it("mints repo tokens (admin only) that work only for their repo", async () => {
    const denied = await app.request("/api/v1/repos/acme/app/token", {
      method: "POST",
      headers: { authorization: "Bearer wrong" },
    });
    expect(denied.status).toBe(401);

    const minted = await app.request("/api/v1/repos/acme/app/token", {
      method: "POST",
      headers: { authorization: "Bearer sekret" },
    });
    expect(minted.status).toBe(200);
    const { token } = await minted.json();

    const ok = await app.request("/api/v1/upload?repo=acme/app&branch=main&commit=tok1", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: lcov,
    });
    expect(ok.status).toBe(200);

    const otherRepo = await app.request("/api/v1/upload?repo=acme/other&branch=main&commit=tok2", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: lcov,
    });
    expect(otherRepo.status).toBe(401);
  });

  it("rate limits uploads per token", async () => {
    const tight = createApp({ store, uploadToken: "sekret", uploadsPerMinute: 2 });
    const hit = () =>
      tight.request("/api/v1/upload?repo=acme/limited&branch=main&commit=rl", {
        method: "POST",
        headers: { authorization: "Bearer sekret" },
        body: lcov,
      });
    expect((await hit()).status).toBe(200);
    expect((await hit()).status).toBe(200);
    expect((await hit()).status).toBe(429);
  });
});

describe("PRs and compare", () => {
  it("groups uploads by PR and compares against a base branch", async () => {
    await upload("repo=acme/app&branch=feat/x&commit=pr1a&pr=7");
    const better = lcov.replace("DA:2,0", "DA:2,4");
    await app.request("/api/v1/upload?repo=acme/app&branch=feat/x&commit=pr1b&pr=7", {
      method: "POST",
      headers: { authorization: "Bearer sekret" },
      body: better,
    });

    const prs = await (await app.request("/api/v1/repos/acme/app/prs")).json();
    const seven = prs.prs.find((p: { pr: number }) => p.pr === 7);
    expect(seven.uploads).toBe(2);
    expect(seven.latest.commit).toBe("pr1b");

    const cmp = await (await app.request("/api/v1/repos/acme/app/compare?pr=7&base=main")).json();
    expect(cmp.head.commit).toBe("pr1b");
    expect(cmp.base.branch).toBe("main");
    expect(cmp.same).toBe(false);
    expect(cmp.head.percent).toBeGreaterThan(cmp.base.percent);
    expect(Array.isArray(cmp.changes.changed)).toBe(true);

    const byBranch = await (
      await app.request("/api/v1/repos/acme/app/compare?head=feat/x&base=main")
    ).json();
    expect(byBranch.head.commit).toBe("pr1b");

    const missing = await app.request("/api/v1/repos/acme/app/compare?pr=999");
    expect(missing.status).toBe(404);
  });

  it("explains how the base was chosen, and prefers a CI-supplied base-sha", async () => {
    const cmp = await (await app.request("/api/v1/repos/acme/app/compare?pr=7&base=main")).json();
    expect(cmp.baseline).toMatchObject({ reason: "latest-on-base", baseBranch: "main" });
    expect(cmp.baseline.message).toContain("latest on main");
    expect(cmp.baseline.commit).toBe(cmp.base.commit);

    // Pin the PR's base to an older main commit via base-sha.
    await app.request(
      "/api/v1/upload?repo=acme/app&branch=feat/x&commit=pr1c&pr=7&base-sha=abc1234",
      {
        method: "POST",
        headers: { authorization: "Bearer sekret" },
        body: lcov,
      },
    );
    const pinned = await (
      await app.request("/api/v1/repos/acme/app/compare?pr=7&base=main")
    ).json();
    expect(pinned.head.commit).toBe("pr1c");
    expect(pinned.base.commit).toBe("abc1234");
    expect(pinned.baseline.reason).toBe("base-sha");

    // No uploads on the base branch: friendly explanation, not a bare 404.
    // (pr=7's head carries a base-sha, which would override even a bad ?base.)
    const orphan = await app.request("/api/v1/repos/acme/app/compare?head=main&base=ghost");
    expect(orphan.status).toBe(404);
    const body = await orphan.json();
    expect(body.baseline.reason).toBe("base-branch-empty");
    expect(body.error).toContain("ghost has no builds yet");
  });
});

describe("upload detail baseline transparency", () => {
  it("labels the first build on a branch, then the previous upload", async () => {
    const first = await (await upload("repo=base/app&branch=main&commit=b1")).json();
    const d1 = await (await app.request(`/api/v1/uploads/${first.id}`)).json();
    expect(d1.baseline).toMatchObject({ reason: "first-on-branch", commit: null });
    expect(d1.baseline.message).toBe("No baseline — first build on main");

    const second = await (await upload("repo=base/app&branch=main&commit=b2")).json();
    const d2 = await (await app.request(`/api/v1/uploads/${second.id}`)).json();
    expect(d2.baseline).toMatchObject({ reason: "previous-on-branch", commit: "b1" });
  });
});

describe("default branch setting", () => {
  it("reads the heuristic, accepts an admin override, and clears it", async () => {
    await upload("repo=acme/defbr&branch=master&commit=m1");
    const before = await (await app.request("/api/v1/repos/acme/defbr/default-branch")).json();
    expect(before).toMatchObject({ branch: "master", configured: false });

    const put = (body: unknown, token = "sekret") =>
      app.request("/api/v1/repos/acme/defbr/default-branch", {
        method: "PUT",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    expect((await put({ branch: "develop" }, "wrong")).status).toBe(401);
    expect((await put({ branch: "has space" })).status).toBe(400);
    expect((await put({})).status).toBe(400);
    expect((await put({ branch: "develop" })).status).toBe(200);

    const after = await (await app.request("/api/v1/repos/acme/defbr/default-branch")).json();
    expect(after).toMatchObject({ branch: "develop", configured: true });

    const del = await app.request("/api/v1/repos/acme/defbr/default-branch", {
      method: "DELETE",
      headers: { authorization: "Bearer sekret" },
    });
    expect(del.status).toBe(200);
    expect((await del.json()).branch).toBe("master");
  });
});

describe("policy and status gate", () => {
  const put = (body: unknown, token = "sekret") =>
    app.request("/api/v1/repos/acme/gate/policy", {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("reads null before anything is set", async () => {
    const json = await (await app.request("/api/v1/repos/acme/gate/policy")).json();
    expect(json.policy).toBe(null);
  });

  it("guards writes with the admin token and validates the body", async () => {
    expect((await put({ minProject: 50 }, "wrong")).status).toBe(401);
    expect(await put({}).then((r) => r.status)).toBe(400);
    expect((await put({ minProject: 500 })).status).toBe(400);
    const ok = await put({ minProject: 50, maxDrop: 0 });
    expect(ok.status).toBe(200);
    const read = await (await app.request("/api/v1/repos/acme/gate/policy")).json();
    expect(read.policy).toEqual({ minProject: 50, maxDrop: 0 });
  });

  it("passes and fails the status gate on the latest upload", async () => {
    await upload("repo=acme/gate&branch=main&commit=g1"); // 66.66%
    await put({ minProject: 50 });
    const pass = await (await app.request("/api/v1/repos/acme/gate/status")).json();
    expect(pass.configured).toBe(true);
    expect(pass.passed).toBe(true);

    await put({ minProject: 90 });
    const fail = await (await app.request("/api/v1/repos/acme/gate/status")).json();
    expect(fail.passed).toBe(false);
    expect(fail.violations[0].kind).toBe("project");

    const badge = await (await app.request("/status/acme/gate.svg")).text();
    expect(badge).toContain("failing");
  });

  it("gates a PR comparison on the coverage drop", async () => {
    const worse = lcov.replace("DA:3,5", "DA:3,0"); // 1/3 = 33% on the PR head
    await app.request("/api/v1/upload?repo=acme/gate&branch=feat/drop&commit=d1&pr=4", {
      method: "POST",
      headers: { authorization: "Bearer sekret" },
      body: worse,
    });
    await put({ maxDrop: 0 });
    const status = await (
      await app.request("/api/v1/repos/acme/gate/status?pr=4&base=main")
    ).json();
    expect(status.basis).toBe("compare");
    expect(status.passed).toBe(false);
    expect(status.violations[0].kind).toBe("drop");

    // The compare endpoint carries the same verdict.
    const cmp = await (await app.request("/api/v1/repos/acme/gate/compare?pr=4&base=main")).json();
    expect(cmp.policy.passed).toBe(false);
  });

  it("ships a self-contained verdict on the compare and upload-detail payloads", async () => {
    await put({ minProject: 50, maxDrop: 0, minNewFile: 80 });
    // A second PR upload: a.ts drops to 2/3 and a new b.ts lands at 1/2 = 50%.
    const withNewFile = `${lcov}SF:src/b.ts
DA:1,0
DA:2,5
end_of_record
`;
    const posted = await (
      await app.request("/api/v1/upload?repo=acme/gate&branch=feat/drop&commit=d2&pr=4", {
        method: "POST",
        headers: { authorization: "Bearer sekret" },
        body: withNewFile,
      })
    ).json();

    const cmp = await (await app.request("/api/v1/repos/acme/gate/compare?pr=4&base=main")).json();
    expect(cmp.verdict.configured).toBe(true);
    expect(cmp.verdict.passed).toBe(false);
    expect(cmp.verdict.rules).toEqual({ minProject: 50, maxDrop: 0, minNewFile: 80 });
    expect(cmp.verdict.head).toMatchObject({ commit: "d2" });
    expect(cmp.verdict.base).toMatchObject({ commit: "g1" });
    expect(cmp.verdict.base.percent).toBeCloseTo(66.66, 1);
    expect(cmp.verdict.newFiles).toEqual({ total: 1, belowFloor: 1 });
    expect(cmp.verdict.violations.map((v: { kind: string }) => v.kind).sort()).toEqual([
      "drop",
      "new-file",
    ]);

    // The upload detail carries the same verdict, judged against its baseline.
    const detail = await (await app.request(`/api/v1/uploads/${posted.id}`)).json();
    expect(detail.verdict.passed).toBe(false);
    expect(detail.verdict.base).toMatchObject({ commit: "g1" });
    expect(detail.verdict.newFiles).toEqual({ total: 1, belowFloor: 1 });

    // No policy → the gate is open, and the card can say so kindly.
    const del = await app.request("/api/v1/repos/acme/gate/policy", {
      method: "DELETE",
      headers: { authorization: "Bearer sekret" },
    });
    expect(del.status).toBe(200);
    const open = await (await app.request(`/api/v1/uploads/${posted.id}`)).json();
    expect(open.verdict).toMatchObject({ configured: false, passed: true, rules: null });
    // Restore the earlier maxDrop-only policy so the DELETE test below still exercises it.
    await put({ maxDrop: 0 });
  });

  it("clears the policy on DELETE", async () => {
    const del = await app.request("/api/v1/repos/acme/gate/policy", {
      method: "DELETE",
      headers: { authorization: "Bearer sekret" },
    });
    expect(del.status).toBe(200);
    const json = await (await app.request("/api/v1/repos/acme/gate/policy")).json();
    expect(json.policy).toBe(null);
    // With no policy the badge reads "no policy" and the gate is open.
    const badge = await (await app.request("/status/acme/gate.svg")).text();
    expect(badge).toContain("no policy");
  });
});

describe("visualization data endpoints", () => {
  it("returns a per-line coverage bitmap on the upload detail", async () => {
    const r = await upload("repo=viz/app&branch=main&commit=v1");
    const id = (await r.json()).id;
    const detail = await (await app.request(`/api/v1/uploads/${id}`)).json();
    const file = detail.files.find((f: { path: string }) => f.path === "src/a.ts");
    // lcov is DA:1,5 / DA:2,0 / DA:3,5 → covered, missed, covered.
    expect(file.cov).toBe("202");
  });

  it("returns a portfolio coverage-debt series", async () => {
    const json = await (await app.request("/api/v1/trends")).json();
    expect(Array.isArray(json.series)).toBe(true);
    expect(json.series.length).toBeGreaterThan(0);
    const pt = json.series[json.series.length - 1];
    expect(pt).toHaveProperty("covered");
    expect(pt).toHaveProperty("total");
    expect(pt.total).toBeGreaterThanOrEqual(pt.covered);
  });

  it("returns covered-lines by top-level directory over time", async () => {
    await upload("repo=viz/dirs&branch=main&commit=d1");
    const json = await (await app.request("/api/v1/repos/viz/dirs/dir-trends")).json();
    expect(json.branch).toBe("main");
    expect(json.steps.length).toBeGreaterThan(0);
    const src = json.dirs.find((d: { dir: string }) => d.dir === "src");
    expect(src).toBeTruthy();
    expect(src.values.length).toBe(json.steps.length);
    expect(src.values[src.values.length - 1]).toBeGreaterThan(0);
  });

  it("404s dir-trends for an unknown repo", async () => {
    const res = await app.request("/api/v1/repos/no/such/dir-trends");
    expect(res.status).toBe(404);
  });
});

describe("sharded upload merge", () => {
  const post = (query: string, body: string) =>
    app.request(`/api/v1/upload?${query}`, {
      method: "POST",
      headers: { authorization: "Bearer sekret" },
      body,
    });

  it("merges shards for the same commit with ?merge=1", async () => {
    const shardA = "SF:src/a.ts\nDA:1,1\nDA:2,0\nend_of_record\n"; // a.ts 1/2
    const shardB = "SF:src/b.ts\nDA:1,1\nDA:2,1\nend_of_record\n"; // b.ts 2/2
    const q = "repo=shard/app&branch=main&commit=deadbeef&merge=1";
    const j1 = await (await post(q, shardA)).json();
    expect(j1.merged).toBe(false); // first shard creates the upload
    const j2 = await (await post(q, shardB)).json();
    expect(j2.merged).toBe(true); // second shard accumulates into it
    expect(j2.id).toBe(j1.id); // same row, not a new snapshot

    const detail = await (await app.request(`/api/v1/uploads/${j1.id}`)).json();
    expect(detail.totals.lines.covered).toBe(3); // 1 + 2
    expect(detail.totals.lines.total).toBe(4); // 2 + 2
    expect(detail.files.map((f: { path: string }) => f.path).sort()).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
  });

  it("keeps distinct snapshots for the same commit without ?merge", async () => {
    const q = "repo=nomerge/app&branch=main&commit=c1";
    const body = "SF:x.ts\nDA:1,1\nend_of_record\n";
    const a = await (await post(q, body)).json();
    const b = await (await post(q, body)).json();
    expect(b.merged).toBe(false);
    expect(b.id).not.toBe(a.id); // two separate uploads, as before
  });
});

describe("ignore paths on upload", () => {
  it("excludes files matching ?ignore globs before recording", async () => {
    const body =
      "SF:src/a.ts\nDA:1,1\nDA:2,0\nend_of_record\n" + // kept: 1/2
      "SF:src/a.test.ts\nDA:1,1\nend_of_record\n" + // ignored
      "SF:node_modules/dep.ts\nDA:1,0\nend_of_record\n"; // ignored
    const ig = encodeURIComponent("*.test.ts,node_modules");
    const res = await app.request(
      `/api/v1/upload?repo=ig/app&branch=main&commit=ig1&ignore=${ig}`,
      { method: "POST", headers: { authorization: "Bearer sekret" }, body },
    );
    const id = (await res.json()).id;
    const detail = await (await app.request(`/api/v1/uploads/${id}`)).json();
    expect(detail.files.map((f: { path: string }) => f.path)).toEqual(["src/a.ts"]);
    expect(detail.totals.lines.total).toBe(2); // only src/a.ts counted
  });
});

describe("unified activity feed", () => {
  const seedUpload = (feedApp: ReturnType<typeof createApp>, query: string) =>
    feedApp.request(`/api/v1/upload?${query}`, {
      method: "POST",
      headers: { authorization: "Bearer sekret" },
      body: lcov,
    });

  it("merges uploads and runs into a typed, newest-first feed", async () => {
    const db = new SqliteStore(":memory:");
    const feedApp = createApp({ store: db, uploadToken: "sekret" });
    await seedUpload(feedApp, "repo=acme/app&branch=main&commit=c1");
    await db.createTestRun({
      repo: "acme/app",
      branch: "main",
      commit: "c2",
      pr: null,
      framework: "playwright",
      testsPassed: 3,
      testsFailed: 1,
      testsSkipped: 0,
      durationMs: 5,
    });
    await db.createTestRun({
      repo: "acme/web",
      branch: "feat/x",
      commit: "c3",
      pr: 7,
      framework: "storybook",
      testsPassed: 0,
      testsFailed: 0,
      testsSkipped: 0,
      durationMs: 0,
      imageCount: 4,
    });

    const data = await (await feedApp.request("/api/v1/activity")).json();
    expect(data.runsSupported).toBe(true);
    // The legacy coverage-only key survives for older consumers.
    expect(data.uploads).toHaveLength(1);
    expect(data.items.map((item: { type: string }) => item.type).sort()).toEqual([
      "components",
      "coverage",
      "journeys",
    ]);
    const times = data.items.map((item: { createdAt: string }) => Date.parse(item.createdAt));
    expect([...times].sort((a: number, b: number) => b - a)).toEqual(times);
    expect(data.items.find((item: { type: string }) => item.type === "components")).toMatchObject({
      repo: "acme/web",
      pr: 7,
      imageCount: 4,
      reviewState: "pending",
    });
    expect(data.items.find((item: { type: string }) => item.type === "journeys")).toMatchObject({
      repo: "acme/app",
      testsFailed: 1,
    });
    // The feed never carries report blobs or artifact rows.
    expect(data.items.every((item: object) => !("report" in item) && !("artifacts" in item))).toBe(
      true,
    );
  });

  it("degrades to uploads-only on stores without test-run support (D1)", async () => {
    const db = new SqliteStore(":memory:");
    Object.defineProperty(db, "recentRuns", { value: undefined });
    const feedApp = createApp({ store: db, uploadToken: "sekret" });
    await seedUpload(feedApp, "repo=acme/app&branch=main&commit=solo");

    const data = await (await feedApp.request("/api/v1/activity")).json();
    expect(data.runsSupported).toBe(false);
    expect(data.items.map((item: { type: string }) => item.type)).toEqual(["coverage"]);
  });
});

describe("repo-scoped activity feed", () => {
  const seedUpload = (feedApp: ReturnType<typeof createApp>, query: string) =>
    feedApp.request(`/api/v1/upload?${query}`, {
      method: "POST",
      headers: { authorization: "Bearer sekret" },
      body: lcov,
    });

  const seedRun = (db: SqliteStore, input: { branch: string; framework: string; repo?: string }) =>
    db.createTestRun({
      repo: input.repo ?? "acme/app",
      branch: input.branch,
      commit: `c-${input.framework}-${input.branch}`,
      pr: null,
      framework: input.framework,
      testsPassed: 2,
      testsFailed: 0,
      testsSkipped: 0,
      durationMs: 5,
    });

  async function seededApp() {
    const db = new SqliteStore(":memory:");
    const feedApp = createApp({ store: db, uploadToken: "sekret" });
    await seedUpload(feedApp, "repo=acme/app&branch=main&commit=m1");
    await seedUpload(feedApp, "repo=acme/app&branch=feat/x&commit=f1&pr=7");
    await seedUpload(feedApp, "repo=acme/other&branch=main&commit=o1"); // another repo: never leaks in
    await seedRun(db, { branch: "main", framework: "playwright" });
    await seedRun(db, { branch: "feat/x", framework: "storybook" });
    await seedRun(db, { branch: "main", framework: "storybook", repo: "acme/other" });
    return feedApp;
  }

  it("merges all-branch uploads with both run frameworks, scoped to the repo", async () => {
    const feedApp = await seededApp();
    const data = await (await feedApp.request("/api/v1/repos/acme/app/activity")).json();
    expect(data.repo).toBe("acme/app");
    expect(data.branch).toBeNull();
    expect(data.runsSupported).toBe(true);
    expect(data.items.map((item: { type: string }) => item.type).sort()).toEqual([
      "components",
      "coverage",
      "coverage",
      "journeys",
    ]);
    expect(data.items.every((item: { repo: string }) => item.repo === "acme/app")).toBe(true);
    const times = data.items.map((item: { createdAt: string }) => Date.parse(item.createdAt));
    expect([...times].sort((a: number, b: number) => b - a)).toEqual(times);
    // The feed never carries report blobs or artifact rows.
    expect(data.items.every((item: object) => !("report" in item) && !("artifacts" in item))).toBe(
      true,
    );
  });

  it("narrows both uploads and runs to one lane with ?branch=", async () => {
    const feedApp = await seededApp();
    const data = await (
      await feedApp.request(
        `/api/v1/repos/acme/app/activity?branch=${encodeURIComponent("feat/x")}`,
      )
    ).json();
    expect(data.branch).toBe("feat/x");
    expect(data.items.every((item: { branch: string }) => item.branch === "feat/x")).toBe(true);
    expect(data.items.map((item: { type: string }) => item.type).sort()).toEqual([
      "components",
      "coverage",
    ]);
  });

  it("degrades to uploads-only on stores without test-run support (D1)", async () => {
    const db = new SqliteStore(":memory:");
    Object.defineProperty(db, "listTestRuns", { value: undefined });
    const feedApp = createApp({ store: db, uploadToken: "sekret" });
    await seedUpload(feedApp, "repo=acme/app&branch=main&commit=solo");

    const data = await (await feedApp.request("/api/v1/repos/acme/app/activity")).json();
    expect(data.runsSupported).toBe(false);
    expect(data.items.map((item: { type: string }) => item.type)).toEqual(["coverage"]);
  });

  it("returns an empty feed for a repo with no evidence", async () => {
    const db = new SqliteStore(":memory:");
    const feedApp = createApp({ store: db, uploadToken: "sekret" });
    const data = await (await feedApp.request("/api/v1/repos/acme/ghost/activity")).json();
    expect(data.items).toEqual([]);
  });
});
