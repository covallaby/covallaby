import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { type D1Database, type D1PreparedStatement, D1Store } from "../src/store/d1.js";
import type { CoverageReport } from "../src/vendor/model.js";

/**
 * A D1Database backed by node:sqlite, so the D1 adapter's real SQL and logic
 * run deterministically in Vitest without spinning up workerd. D1's
 * prepare().bind().all()/first()/run() shape maps cleanly onto DatabaseSync.
 */
class FakeD1 implements D1Database {
  private readonly db = new DatabaseSync(":memory:");

  prepare(sql: string): D1PreparedStatement {
    const db = this.db;
    let args: unknown[] = [];
    // biome-ignore lint/suspicious/noExplicitAny: node:sqlite bind params are loosely typed
    const run = (fn: (s: ReturnType<DatabaseSync["prepare"]>) => any) => fn(db.prepare(sql));
    const stmt: D1PreparedStatement = {
      bind(...values) {
        args = values;
        return stmt;
      },
      async all<T>() {
        return { results: run((s) => s.all(...(args as never[]))) as T[] };
      },
      async first<T>() {
        return (run((s) => s.get(...(args as never[]))) ?? null) as T | null;
      },
      async run() {
        const r = run((s) => s.run(...(args as never[])));
        return { meta: { last_row_id: Number(r.lastInsertRowid) } };
      },
    };
    return stmt;
  }

  async exec(sql: string) {
    this.db.exec(sql);
    return {};
  }
}

const report: CoverageReport = {
  files: [{ path: "src/a.ts", lines: [{ line: 1, hits: 1 }], functions: [], branches: [] }],
};

const base = {
  branch: "main",
  commit: "abc",
  pr: null,
  report,
  linesCovered: 8,
  linesTotal: 10,
  files: 1,
};

describe("D1Store (via node:sqlite fake)", () => {
  let store: D1Store;
  beforeEach(() => {
    store = new D1Store(new FakeD1());
  });

  it("records an upload and reads it back with the gzipped report intact", async () => {
    const row = await store.recordUpload({ repo: "acme/app", ...base });
    expect(row.id).toBeGreaterThan(0);
    expect(row.percent).toBeCloseTo(80);
    const fetched = await store.getUpload(row.id);
    expect(fetched?.report.files[0]?.path).toBe("src/a.ts"); // BLOB round-trips
  });

  it("builds repo overviews with a trend", async () => {
    await store.recordUpload({ repo: "acme/app", ...base, commit: "c1" });
    await store.recordUpload({ repo: "acme/app", ...base, commit: "c2", linesCovered: 9 });
    const repos = await store.listRepos(12);
    expect(repos).toHaveLength(1);
    expect(repos[0]?.latest.commit).toBe("c2");
    expect(repos[0]?.trend.length).toBe(2);
  });

  it("scopes cross-repo reads by account", async () => {
    await store.recordUpload({ repo: "acme/app", ...base });
    await store.recordUpload({ repo: "other/thing", ...base });
    expect((await store.listRepos(12)).length).toBe(2);
    const scoped = await store.listRepos(12, ["acme"]);
    expect(scoped).toHaveLength(1);
    expect(scoped[0]?.repo).toBe("acme/app");
    expect(await store.listRepos(12, [])).toEqual([]);
    const recent = await store.recentUploads(50, ["other"]);
    expect(recent.every((u) => u.repo.startsWith("other/"))).toBe(true);
  });

  it("groups PRs and finds the previous upload", async () => {
    const first = await store.recordUpload({ repo: "acme/app", ...base, commit: "c1", pr: 7 });
    await store.recordUpload({ repo: "acme/app", ...base, commit: "c2", pr: 7 });
    const prs = await store.listPRs("acme/app", 10);
    expect(prs[0]?.pr).toBe(7);
    expect(prs[0]?.uploads).toBe(2);
    const prev = await store.prevUpload("acme/app", "main", first.id + 1);
    expect(prev?.row.id).toBe(first.id);
  });

  it("round-trips the CI-supplied base SHA", async () => {
    const row = await store.recordUpload({ repo: "acme/app", ...base, baseSha: "a".repeat(40) });
    expect(row.baseSha).toBe("a".repeat(40));
    expect((await store.getUpload(row.id))?.row.baseSha).toBe("a".repeat(40));
    const bare = await store.recordUpload({ repo: "acme/app", ...base, commit: "def" });
    expect(bare.baseSha).toBeNull();
  });

  it("adds the base_sha column to databases created before it existed", async () => {
    const legacy = new FakeD1();
    await legacy.exec(
      `CREATE TABLE uploads (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         repo TEXT NOT NULL, branch TEXT NOT NULL, commit_sha TEXT NOT NULL, pr INTEGER,
         lines_covered INTEGER NOT NULL, lines_total INTEGER NOT NULL, files INTEGER NOT NULL,
         report BLOB NOT NULL, account TEXT NOT NULL DEFAULT '',
         created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`,
    );
    const migrated = new D1Store(legacy);
    const row = await migrated.recordUpload({ repo: "acme/app", ...base, baseSha: "f".repeat(7) });
    expect(row.baseSha).toBe("f".repeat(7));
  });

  it("persists repo tokens, meta, and subscriptions", async () => {
    await store.setRepoToken("acme/app", "tok");
    expect(await store.getRepoToken("acme/app")).toBe("tok");
    await store.setMeta("upload-token", "xyz");
    expect(await store.getMeta("upload-token")).toBe("xyz");
    await store.setSubscription({
      account: "acme",
      plan: "pro",
      status: "active",
      stripeCustomer: "cus_1",
      currentPeriodEnd: null,
    });
    expect((await store.getSubscription("acme"))?.plan).toBe("pro");
    expect((await store.findSubscriptionByCustomer("cus_1"))?.account).toBe("acme");
  });
});
