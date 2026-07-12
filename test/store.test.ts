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
});
