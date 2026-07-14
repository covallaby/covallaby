import { afterAll, describe, expect, it } from "vitest";
import {
  defaultBranchKey,
  pickDefaultBranch,
  resolveCoverageBaseline,
  resolveDefaultBranch,
  resolveVisualBaseline,
} from "../src/baseline.js";
import { repoRetentionKey } from "../src/retention.js";
import type { ReviewState, Store } from "../src/store.js";
import { SqliteStore } from "../src/store/sqlite.js";
import type { CoverageReport } from "../src/vendor/model.js";

const report: CoverageReport = {
  files: [{ path: "src/a.ts", lines: [{ line: 1, hits: 1 }], functions: [], branches: [] }],
};

const store: Store = new SqliteStore(":memory:");
afterAll(async () => {
  await store.close();
});

const upload = (repo: string, branch: string, commit: string, baseSha: string | null = null) =>
  store.recordUpload({
    repo,
    branch,
    commit,
    pr: null,
    report,
    linesCovered: 1,
    linesTotal: 1,
    files: 1,
    baseSha,
  });

const visualRun = async (
  repo: string,
  branch: string,
  commit: string,
  reviewState: ReviewState,
  opts: { baseSha?: string | null; complete?: boolean } = {},
) => {
  const run = await store.createTestRun!({
    repo,
    branch,
    commit,
    pr: null,
    framework: "storybook",
    testsPassed: 0,
    testsFailed: 0,
    testsSkipped: 0,
    durationMs: 0,
    baseSha: opts.baseSha ?? null,
    reviewState,
  });
  return opts.complete === false ? run : (await store.completeTestRun!(run.id))!;
};

describe("default branch resolution", () => {
  it("prefers main/master, else the first listed branch, else the fallback", () => {
    expect(pickDefaultBranch(["dev", "master"])).toBe("master");
    expect(pickDefaultBranch(["dev", "main"])).toBe("main");
    expect(pickDefaultBranch(["trunk", "dev"])).toBe("trunk");
    expect(pickDefaultBranch([])).toBe("main");
    expect(pickDefaultBranch([], "develop")).toBe("develop");
  });

  it("uses the explicit override, then GitHub sync state, then the heuristic", async () => {
    const repo = "acme/default-branch";
    expect(await resolveDefaultBranch(store, repo)).toBe("main"); // nothing known
    await upload(repo, "master", "m1");
    expect(await resolveDefaultBranch(store, repo)).toBe("master"); // heuristic
    await store.setMeta(repoRetentionKey(repo), JSON.stringify({ defaultBranch: "trunk" }));
    expect(await resolveDefaultBranch(store, repo)).toBe("trunk"); // GitHub App sync
    await store.setMeta(defaultBranchKey(repo), "release");
    expect(await resolveDefaultBranch(store, repo)).toBe("release"); // explicit override
    await store.setMeta(defaultBranchKey(repo), ""); // cleared → back to sync state
    expect(await resolveDefaultBranch(store, repo)).toBe("trunk");
  });

  it("survives corrupt sync state", async () => {
    const repo = "acme/corrupt-sync";
    await store.setMeta(repoRetentionKey(repo), "not json");
    await upload(repo, "main", "c1");
    expect(await resolveDefaultBranch(store, repo)).toBe("main");
  });
});

describe("coverage baseline resolution", () => {
  it("walks the documented fallback order for a feature-branch head", async () => {
    const repo = "acme/coverage";

    // Base branch empty: nothing on main yet.
    const orphan = await upload(repo, "feat/one", "f1");
    const empty = await resolveCoverageBaseline(store, orphan, "main");
    expect(empty.base).toBeNull();
    expect(empty.info.reason).toBe("base-branch-empty");
    expect(empty.info.message).toContain("No baseline");

    // Latest earlier upload on the base branch wins.
    const main1 = await upload(repo, "main", "aaaa111");
    const main2 = await upload(repo, "main", "bbbb222");
    const head = await upload(repo, "feat/one", "f2");
    const later = await upload(repo, "main", "cccc333"); // newer than head — not preferred
    const picked = await resolveCoverageBaseline(store, head, "main");
    expect(picked.base?.id).toBe(main2.id);
    expect(picked.info.reason).toBe("latest-on-base");
    expect(picked.info.message).toBe("Baseline: bbbb222 (latest on main)");

    // A CI-supplied base SHA overrides the branch walk.
    const pinned = await upload(repo, "feat/one", "f3", main1.commit);
    const exact = await resolveCoverageBaseline(store, pinned, "main");
    expect(exact.base?.id).toBe(main1.id);
    expect(exact.info.reason).toBe("base-sha");

    // A base-sha with no recorded upload falls back to the branch walk.
    const dangling = await upload(repo, "feat/one", "f4", "e".repeat(40));
    const fallback = await resolveCoverageBaseline(store, dangling, "main");
    expect(fallback.base?.id).toBe(later.id);
    expect(fallback.info.reason).toBe("latest-on-base");
  });

  it("uses the previous upload when the head is on the base branch itself", async () => {
    const repo = "acme/mainline";
    const first = await upload(repo, "main", "m1");
    const firstInfo = await resolveCoverageBaseline(store, first, "main");
    expect(firstInfo.base).toBeNull();
    expect(firstInfo.info.reason).toBe("first-on-branch");
    expect(firstInfo.info.message).toBe("No baseline — first build on main");

    const second = await upload(repo, "main", "m2");
    const prev = await resolveCoverageBaseline(store, second, "main");
    expect(prev.base?.id).toBe(first.id);
    expect(prev.info.reason).toBe("previous-on-branch");
  });

  it("falls back to a newer base upload when nothing earlier exists", async () => {
    const repo = "acme/newer";
    const head = await upload(repo, "feat/x", "h1");
    const main = await upload(repo, "main", "m1"); // recorded after the head
    const picked = await resolveCoverageBaseline(store, head, "main");
    expect(picked.base?.id).toBe(main.id);
    expect(picked.info.reason).toBe("newer-on-base");
    expect(picked.info.message).toContain("recorded after this build");
  });
});

describe("visual baseline resolution", () => {
  it("only accepts complete, accepted default-branch runs as baselines", async () => {
    const repo = "acme/visual";
    const accepted = await visualRun(repo, "main", "v1", "auto-accepted");
    await visualRun(repo, "main", "v2", "rejected"); // human said no
    await visualRun(repo, "main", "v3", "pending"); // never reviewed
    await visualRun(repo, "main", "v4", "auto-accepted", { complete: false }); // still uploading
    const head = await visualRun(repo, "feat/x", "v5", "pending");

    const picked = await resolveVisualBaseline(store, head, "main");
    expect(picked.baseline?.id).toBe(accepted.id);
    expect(picked.info.reason).toBe("latest-on-base");

    const approved = await visualRun(repo, "main", "v6", "approved");
    const head2 = await visualRun(repo, "feat/x", "v7", "pending");
    const repick = await resolveVisualBaseline(store, head2, "main");
    expect(repick.baseline?.id).toBe(approved.id); // human-approved counts too
  });

  it("prefers a CI-supplied base SHA over the branch walk", async () => {
    const repo = "acme/visual-sha";
    const old = await visualRun(repo, "main", "a".repeat(40), "auto-accepted");
    await visualRun(repo, "main", "b".repeat(40), "auto-accepted");
    const head = await visualRun(repo, "feat/x", "c".repeat(40), "pending", {
      baseSha: "a".repeat(40),
    });
    const picked = await resolveVisualBaseline(store, head, "main");
    expect(picked.baseline?.id).toBe(old.id);
    expect(picked.info.reason).toBe("base-sha");
  });

  it("explains orphans: first build on the branch vs an empty base branch", async () => {
    const repo = "acme/visual-orphan";
    const feature = await visualRun(repo, "feat/x", "o1", "pending");
    const orphan = await resolveVisualBaseline(store, feature, "main");
    expect(orphan.baseline).toBeNull();
    expect(orphan.info.reason).toBe("base-branch-empty");

    const mainline = await visualRun(repo, "main", "o2", "auto-accepted");
    const first = await resolveVisualBaseline(store, mainline, "main");
    expect(first.baseline).toBeNull();
    expect(first.info.reason).toBe("first-on-branch");

    const next = await visualRun(repo, "main", "o3", "auto-accepted");
    const prev = await resolveVisualBaseline(store, next, "main");
    expect(prev.baseline?.id).toBe(mainline.id);
    expect(prev.info.reason).toBe("previous-on-branch");
  });
});
