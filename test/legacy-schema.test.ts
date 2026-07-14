import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, describe, expect, it } from "vitest";
import { SqliteStore } from "../src/store/sqlite.js";

// Regression for the 2026-07-14 production crash loop: on a database created
// BEFORE the account/image_count columns existed, the schema block's
// CREATE TABLE IF NOT EXISTS is a no-op, so any index on a migrated column
// must be created after the ALTER phase, not inside the schema block.
// This test opens a store against a legacy-shaped file and asserts boot,
// column presence, and index presence.
describe("legacy database migration ordering", () => {
  const dir = mkdtempSync(join(tmpdir(), "covallaby-legacy-"));
  const path = join(dir, "legacy.db");

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("boots against a pre-account test_runs table and migrates it", async () => {
    // Recreate the pre-#31 shape: test_runs WITHOUT account/image_count
    // (and pre-#24: without base_sha/review_state), matching what production
    // looked like when the crash occurred.
    const raw = new DatabaseSync(path);
    raw.exec(`
      CREATE TABLE test_runs (
        id INTEGER PRIMARY KEY, repo TEXT NOT NULL, branch TEXT NOT NULL,
        commit_sha TEXT NOT NULL, pr INTEGER, framework TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'uploading',
        tests_passed INTEGER NOT NULL DEFAULT 0, tests_failed INTEGER NOT NULL DEFAULT 0,
        tests_skipped INTEGER NOT NULL DEFAULT 0, duration_ms INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), completed_at TEXT
      );
    `);
    raw.exec(
      "INSERT INTO test_runs (repo, branch, commit_sha, framework) VALUES ('acme/web', 'main', 'abc1234', 'playwright')",
    );
    raw.close();

    // Opening the store runs schema + migrations; before the fix this threw
    // "no such column: account" from the index inside the schema block.
    const store = new SqliteStore(path);

    const migrated = new DatabaseSync(path, { readOnly: true });
    const columns = migrated
      .prepare("SELECT name FROM pragma_table_info('test_runs')")
      .all()
      .map((r) => r.name);
    expect(columns).toContain("account");
    expect(columns).toContain("image_count");
    expect(columns).toContain("base_sha");
    expect(columns).toContain("review_state");

    const indexes = migrated
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'test_runs'")
      .all()
      .map((r) => r.name);
    expect(indexes).toContain("idx_test_runs_account");

    // Backfill populated the tenant column for the legacy row.
    const row = migrated.prepare("SELECT account FROM test_runs WHERE repo = 'acme/web'").get();
    expect(row?.account).toBe("acme");
    migrated.close();

    // The account-scoped feed query works against the migrated row.
    const runs = await store.recentRuns?.(10, ["acme"]);
    expect(runs?.length).toBe(1);
  });
});
