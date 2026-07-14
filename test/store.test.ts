import { afterAll, describe, expect, it } from "vitest";
import type { Store } from "../src/store.js";
import { SqliteStore } from "../src/store/sqlite.js";
import type { CoverageReport } from "../src/vendor/model.js";

const report: CoverageReport = {
  files: [
    {
      path: "src/a.ts",
      lines: [
        { line: 1, hits: 1 },
        { line: 2, hits: 0 },
      ],
      functions: [],
      branches: [],
    },
  ],
};

async function makeStores(): Promise<Array<[string, Store]>> {
  const stores: Array<[string, Store]> = [["sqlite", new SqliteStore(":memory:")]];
  if (process.env.TEST_DATABASE_URL) {
    const { PostgresStore } = await import("../src/store/postgres.js");
    stores.push(["postgres", await PostgresStore.connect(process.env.TEST_DATABASE_URL)]);
  }
  return stores;
}

const stores = await makeStores();

describe.each(stores)("store contract (%s)", (_name, store) => {
  afterAll(async () => {
    await store.close();
  });

  it("records uploads and reads them back with computed percent", async () => {
    const row = await store.recordUpload({
      repo: "acme/app",
      branch: "main",
      commit: "abc1234",
      pr: null,
      report,
      linesCovered: 1,
      linesTotal: 2,
      files: 1,
    });
    expect(row.percent).toBe(50);

    const found = await store.getUpload(row.id);
    expect(found?.report).toEqual(report);
    expect(found?.row.commit).toBe("abc1234");
  });

  it("lists repos with trends and serves history", async () => {
    for (const [commit, covered] of [
      ["c2", 1],
      ["c3", 2],
    ] as const) {
      await store.recordUpload({
        repo: "acme/app",
        branch: "main",
        commit,
        pr: null,
        report,
        linesCovered: covered,
        linesTotal: 2,
        files: 1,
      });
    }
    const repos = await store.listRepos(12);
    const app = repos.find((r) => r.repo === "acme/app")!;
    expect(app.latest.commit).toBe("c3");
    expect(app.trend.length).toBeGreaterThanOrEqual(3);
    expect(app.trend[app.trend.length - 1]).toBe(100);

    const history = await store.history("acme/app", "main", 10);
    expect(history[0]!.commit).toBe("c3");
    expect(await store.branches("acme/app")).toContain("main");
    expect((await store.latest("acme/app", "main"))?.commit).toBe("c3");
    expect(await store.latest("acme/nope")).toBeNull();
  });

  it("serves recent uploads across repos, newest first", async () => {
    await store.recordUpload({
      repo: "acme/other",
      branch: "main",
      commit: "zzz",
      pr: 7,
      report,
      linesCovered: 2,
      linesTotal: 2,
      files: 1,
    });
    const recent = await store.recentUploads(3);
    expect(recent[0]!.repo).toBe("acme/other");
    expect(recent[0]!.pr).toBe(7);
    expect(recent.length).toBe(3);
  });

  it("finds the previous upload on the same branch", async () => {
    const history = await store.history("acme/app", "main", 10);
    const latest = history[0]!;
    const prev = await store.prevUpload("acme/app", "main", latest.id);
    expect(prev?.row.commit).toBe(history[1]!.commit);
    expect(prev?.report.files.length).toBeGreaterThan(0);
    const first = history[history.length - 1]!;
    expect(await store.prevUpload("acme/app", "main", first.id)).toBeNull();
  });

  it("finds upload neighbors on the same branch, clamped at the ends of history", async () => {
    const rows = [];
    for (const commit of ["n1", "n2", "n3"] as const) {
      rows.push(
        await store.recordUpload({
          repo: "acme/neighbors",
          branch: "main",
          commit,
          pr: null,
          report,
          linesCovered: 1,
          linesTotal: 2,
          files: 1,
        }),
      );
    }
    // Another branch on the same repo must not leak into the lane.
    const stray = await store.recordUpload({
      repo: "acme/neighbors",
      branch: "feat/x",
      commit: "nx",
      pr: 4,
      report,
      linesCovered: 1,
      linesTotal: 2,
      files: 1,
    });

    const mid = await store.uploadNeighbors("acme/neighbors", "main", rows[1]!.id);
    expect(mid.prev?.commit).toBe("n1");
    expect(mid.next?.commit).toBe("n3");

    const first = await store.uploadNeighbors("acme/neighbors", "main", rows[0]!.id);
    expect(first.prev).toBeNull();
    expect(first.next?.commit).toBe("n2");

    const last = await store.uploadNeighbors("acme/neighbors", "main", rows[2]!.id);
    expect(last.prev?.commit).toBe("n2");
    expect(last.next).toBeNull();

    // The lone upload on its branch has no neighbors in either direction.
    const lone = await store.uploadNeighbors("acme/neighbors", "feat/x", stray.id);
    expect(lone).toEqual({ prev: null, next: null });
  });

  it("finds test run neighbors within a repo and framework", async () => {
    const run = (commit: string, framework: string, branch = "main") =>
      store.createTestRun!({
        repo: "acme/run-neighbors",
        branch,
        commit,
        pr: null,
        framework,
        testsPassed: 0,
        testsFailed: 0,
        testsSkipped: 0,
        durationMs: 0,
      });
    const first = await run("s1", "storybook");
    await run("p1", "playwright"); // a different framework between the two storybook runs
    const second = await run("s2", "storybook", "feat/x");

    const atFirst = await store.testRunNeighbors!("acme/run-neighbors", "storybook", first.id);
    expect(atFirst.prev).toBeNull();
    expect(atFirst.next?.commit).toBe("s2"); // skips the playwright run in between

    const atSecond = await store.testRunNeighbors!("acme/run-neighbors", "storybook", second.id);
    expect(atSecond.prev?.commit).toBe("s1");
    expect(atSecond.next).toBeNull();
  });

  it("scopes cross-repo reads by account (hosted multi-tenancy)", async () => {
    await store.recordUpload({
      repo: "other-org/thing",
      branch: "main",
      commit: "oo1",
      pr: null,
      report,
      linesCovered: 1,
      linesTotal: 1,
      files: 1,
    });
    // no scope → sees every account (self-hosted behavior)
    const all = await store.listRepos(12);
    expect(all.some((r) => r.repo === "acme/app")).toBe(true);
    expect(all.some((r) => r.repo === "other-org/thing")).toBe(true);
    // scoped to acme → only acme repos
    const acme = await store.listRepos(12, ["acme"]);
    expect(acme.every((r) => r.repo.startsWith("acme/"))).toBe(true);
    expect(acme.some((r) => r.repo === "other-org/thing")).toBe(false);
    // empty scope → nothing
    expect(await store.listRepos(12, [])).toEqual([]);
    // recentUploads honors the scope too
    const recent = await store.recentUploads(50, ["other-org"]);
    expect(recent.every((u) => u.repo.startsWith("other-org/"))).toBe(true);
  });

  it("stores meta key-values with upsert", async () => {
    await store.setMeta("k", "v1");
    await store.setMeta("k", "v2");
    expect(await store.getMeta("k")).toBe("v2");
    expect(await store.getMeta("missing")).toBeNull();
  });

  it("filters visual runs by framework before applying the result limit", async () => {
    await store.createTestRun!({
      repo: "acme/visuals",
      branch: "main",
      commit: "story1",
      pr: null,
      framework: "storybook",
      testsPassed: 0,
      testsFailed: 0,
      testsSkipped: 0,
      durationMs: 0,
    });
    await store.createTestRun!({
      repo: "acme/visuals",
      branch: "main",
      commit: "play1",
      pr: null,
      framework: "playwright",
      testsPassed: 6,
      testsFailed: 0,
      testsSkipped: 0,
      durationMs: 1200,
    });

    expect(await store.listTestRuns!("acme/visuals", 1, "playwright")).toMatchObject([
      { framework: "playwright", commit: "play1" },
    ]);
    expect(await store.listTestRuns!("acme/visuals", 1, "storybook")).toMatchObject([
      { framework: "storybook", commit: "story1" },
    ]);
  });

  it("round-trips the CI-supplied base SHA on uploads", async () => {
    const row = await store.recordUpload({
      repo: "acme/base-sha",
      branch: "feat/x",
      commit: "headsha",
      pr: 12,
      report,
      linesCovered: 1,
      linesTotal: 2,
      files: 1,
      baseSha: "a".repeat(40),
    });
    expect(row.baseSha).toBe("a".repeat(40));
    expect((await store.getUpload(row.id))?.row.baseSha).toBe("a".repeat(40));
    // Omitted → null (older CI keeps working unchanged).
    const bare = await store.recordUpload({
      repo: "acme/base-sha",
      branch: "main",
      commit: "basesha",
      pr: null,
      report,
      linesCovered: 1,
      linesTotal: 2,
      files: 1,
    });
    expect(bare.baseSha).toBeNull();
  });

  it("stores review state and base SHA on visual runs, with human overrides", async () => {
    const run = await store.createTestRun!({
      repo: "acme/reviews",
      branch: "main",
      commit: "rev1",
      pr: null,
      framework: "storybook",
      testsPassed: 0,
      testsFailed: 0,
      testsSkipped: 0,
      durationMs: 0,
      baseSha: "b".repeat(40),
      reviewState: "auto-accepted",
    });
    expect(run.reviewState).toBe("auto-accepted");
    expect(run.baseSha).toBe("b".repeat(40));
    expect((await store.getTestRunRow!(run.id))?.reviewState).toBe("auto-accepted");

    const rejected = await store.setTestRunReview!(run.id, "rejected");
    expect(rejected?.reviewState).toBe("rejected");
    expect(await store.setTestRunReview!(999_999, "approved")).toBeNull();

    // Defaults: pending review, no base SHA.
    const bare = await store.createTestRun!({
      repo: "acme/reviews",
      branch: "feat/x",
      commit: "rev2",
      pr: 3,
      framework: "storybook",
      testsPassed: 0,
      testsFailed: 0,
      testsSkipped: 0,
      durationMs: 0,
    });
    expect(bare.reviewState).toBe("pending");
    expect(bare.baseSha).toBeNull();
  });

  it("records, updates, clears, and carries per-story capture reviews", async () => {
    const run = async (branch: string, commit: string) =>
      store.createTestRun!({
        repo: "acme/capture-reviews",
        branch,
        commit,
        pr: null,
        framework: "storybook",
        testsPassed: 0,
        testsFailed: 0,
        testsSkipped: 0,
        durationMs: 0,
      });
    const first = await run("feat/a", "cr1");
    const second = await run("feat/a", "cr2");

    // Upsert keyed by (run, story): the second verdict replaces the first.
    await store.setCaptureReview!({
      runId: first.id,
      repo: first.repo,
      storyId: "button--primary",
      state: "approved",
      baselineSha256: "old-hash",
      sha256: "new-hash",
      reviewedBy: "alice",
    });
    const updated = await store.setCaptureReview!({
      runId: first.id,
      repo: first.repo,
      storyId: "button--primary",
      state: "rejected",
      baselineSha256: "old-hash",
      sha256: "new-hash",
      reviewedBy: "bob",
    });
    expect(updated.state).toBe("rejected");
    expect(updated.reviewedBy).toBe("bob");
    expect(updated.reviewedAt).toBeTruthy();

    // New stories key on a single hash (null baseline round-trips).
    await store.setCaptureReview!({
      runId: first.id,
      repo: first.repo,
      storyId: "button--new",
      state: "approved",
      baselineSha256: null,
      sha256: "fresh-hash",
      reviewedBy: null,
    });
    const listed = await store.listCaptureReviews!(first.id);
    expect(listed).toHaveLength(2);
    expect(listed.find((r) => r.storyId === "button--new")).toMatchObject({
      state: "approved",
      baselineSha256: null,
      sha256: "fresh-hash",
      reviewedBy: null,
    });

    // Carry-over lookup matches the exact pair from another run only.
    const carried = await store.findCaptureReviewByPair!(
      first.repo,
      "old-hash",
      "new-hash",
      second.id,
    );
    expect(carried?.state).toBe("rejected");
    // The excluded run's own rows never match…
    expect(
      await store.findCaptureReviewByPair!(first.repo, "old-hash", "new-hash", first.id),
    ).toBeNull();
    // …and neither does a different pair.
    expect(
      await store.findCaptureReviewByPair!(first.repo, "other", "new-hash", second.id),
    ).toBeNull();
    expect(
      (await store.findCaptureReviewByPair!(first.repo, null, "fresh-hash", second.id))?.storyId,
    ).toBe("button--new");

    // Pending is the absence of a row.
    await store.clearCaptureReview!(first.id, "button--primary");
    expect(await store.listCaptureReviews!(first.id)).toHaveLength(1);

    // Deleting the run removes its verdicts.
    await store.deleteTestRun!(first.id);
    expect(await store.listCaptureReviews!(first.id)).toHaveLength(0);
  });
});
