import { describe, expect, it } from "vitest";
import type { ArtifactStorage } from "../src/artifacts.js";
import {
  cleanupRepoArtifacts,
  prRetentionKey,
  recordPRRetentionState,
  recordRepoRetentionState,
} from "../src/retention.js";
import type { Store, TestArtifactRow, TestRunRow } from "../src/store.js";

const day = 86_400_000;
const now = new Date("2026-07-11T12:00:00.000Z");
const run = (
  id: number,
  branch: string,
  ageDays: number,
  pr: number | null = null,
  framework = "playwright",
): TestRunRow => ({
  id,
  repo: "acme/app",
  branch,
  commit: `c${id}`,
  pr,
  framework,
  status: "complete",
  testsPassed: 1,
  testsFailed: 0,
  testsSkipped: 0,
  durationMs: 10,
  createdAt: new Date(now.getTime() - ageDays * day).toISOString(),
  completedAt: null,
});

function fixtures(runs: TestRunRow[]) {
  const meta = new Map<string, string>();
  const artifacts = new Map<number, TestArtifactRow[]>(
    runs.map((r) => [
      r.id,
      [
        {
          id: r.id,
          runId: r.id,
          name: "video.webm",
          kind: "video",
          contentType: "video/webm",
          sizeBytes: 1,
          objectKey: `run-${r.id}`,
          testName: null,
          createdAt: r.createdAt,
        },
      ],
    ]),
  );
  const deletedRuns: number[] = [];
  const deletedObjects: string[] = [];
  const store = {
    listTestRuns: async () => runs.filter((r) => !deletedRuns.includes(r.id)),
    getTestRun: async (id: number) => {
      const found = runs.find((r) => r.id === id);
      return found ? { run: found, artifacts: artifacts.get(id) ?? [] } : null;
    },
    deleteTestRun: async (id: number) => {
      deletedRuns.push(id);
    },
    getMeta: async (key: string) => meta.get(key) ?? null,
    setMeta: async (key: string, value: string) => {
      meta.set(key, value);
    },
  } as unknown as Store;
  const storage = {
    delete: async (key: string) => {
      deletedObjects.push(key);
    },
  } as unknown as ArtifactStorage;
  return { store, storage, meta, deletedRuns, deletedObjects };
}

describe("artifact retention", () => {
  it("keeps latest default-branch and open-PR runs while deleting older runs", async () => {
    const f = fixtures([
      run(6, "main", 40),
      run(5, "main", 50),
      run(4, "feature", 45, 7),
      run(3, "feature", 55, 7),
      run(2, "old", 60),
    ]);
    await recordRepoRetentionState(f.store, "acme/app", "main");
    await recordPRRetentionState(f.store, "acme/app", 7, true, null);
    expect(
      await cleanupRepoArtifacts(
        f.store,
        f.storage,
        "acme/app",
        { days: 30, keepLatestDefaultBranch: true, keepLatestUnknownPR: true },
        now,
      ),
    ).toBe(3);
    expect(f.deletedRuns).toEqual([5, 3, 2]);
    expect(f.deletedObjects).toEqual(["run-5", "run-3", "run-2"]);
  });

  it("gives closed PRs a full grace period from closure", async () => {
    const recent = fixtures([run(1, "feature", 90, 8)]);
    await recordPRRetentionState(
      recent.store,
      "acme/app",
      8,
      false,
      new Date(now.getTime() - 10 * day).toISOString(),
    );
    expect(
      await cleanupRepoArtifacts(
        recent.store,
        recent.storage,
        "acme/app",
        { days: 30, keepLatestDefaultBranch: true, keepLatestUnknownPR: true },
        now,
      ),
    ).toBe(0);

    const old = fixtures([run(1, "feature", 90, 8)]);
    await recordPRRetentionState(
      old.store,
      "acme/app",
      8,
      false,
      new Date(now.getTime() - 40 * day).toISOString(),
    );
    expect(
      await cleanupRepoArtifacts(
        old.store,
        old.storage,
        "acme/app",
        { days: 30, keepLatestDefaultBranch: true, keepLatestUnknownPR: true },
        now,
      ),
    ).toBe(1);
  });

  it("makes unknown-PR pinning configurable for self-hosters", async () => {
    const keep = fixtures([run(1, "feature", 40, 9)]);
    expect(
      await cleanupRepoArtifacts(
        keep.store,
        keep.storage,
        "acme/app",
        { days: 30, keepLatestDefaultBranch: true, keepLatestUnknownPR: true },
        now,
      ),
    ).toBe(0);
    const expire = fixtures([run(1, "feature", 40, 9)]);
    expect(
      await cleanupRepoArtifacts(
        expire.store,
        expire.storage,
        "acme/app",
        { days: 30, keepLatestDefaultBranch: true, keepLatestUnknownPR: false },
        now,
      ),
    ).toBe(1);
    expect(await expire.store.getMeta(prRetentionKey("acme/app", 9))).toBeNull();
  });

  it("retains the latest run for each artifact framework", async () => {
    const f = fixtures([
      run(4, "main", 40, null, "storybook"),
      run(3, "main", 40, null, "playwright"),
      run(2, "feature", 40, 10, "storybook"),
      run(1, "feature", 40, 10, "playwright"),
    ]);
    await recordRepoRetentionState(f.store, "acme/app", "main");
    await recordPRRetentionState(f.store, "acme/app", 10, true, null);
    expect(
      await cleanupRepoArtifacts(
        f.store,
        f.storage,
        "acme/app",
        { days: 30, keepLatestDefaultBranch: true, keepLatestUnknownPR: true },
        now,
      ),
    ).toBe(0);
  });
});
