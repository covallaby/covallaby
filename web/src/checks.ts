import type { StorybookPreview, TestRun, UploadRow } from "./api.js";

export type CommitCheckStatus = "failed" | "ready" | "partial";

export interface CommitCheck {
  repo: string;
  commit: string;
  branch: string;
  pr: number | null;
  createdAt: string;
  coverage: UploadRow | null;
  journey: TestRun | null;
  components: StorybookPreview | null;
  status: CommitCheckStatus;
  missing: Array<"code" | "journeys" | "components">;
}

const newest = <T extends { createdAt: string }>(left: T | null, right: T): T =>
  !left || Date.parse(right.createdAt) > Date.parse(left.createdAt) ? right : left;

export function buildCommitChecks(
  uploads: UploadRow[],
  runs: TestRun[],
  previews: StorybookPreview[],
): CommitCheck[] {
  const checks = new Map<string, CommitCheck>();
  const ensure = (signal: {
    repo: string;
    commit: string;
    branch: string;
    pr: number | null;
    createdAt: string;
  }) => {
    const found = checks.get(signal.commit);
    if (found) {
      if (Date.parse(signal.createdAt) > Date.parse(found.createdAt)) {
        found.createdAt = signal.createdAt;
        found.branch = signal.branch;
        found.pr = signal.pr ?? found.pr;
      }
      return found;
    }
    const created: CommitCheck = {
      repo: signal.repo,
      commit: signal.commit,
      branch: signal.branch,
      pr: signal.pr,
      createdAt: signal.createdAt,
      coverage: null,
      journey: null,
      components: null,
      status: "partial",
      missing: [],
    };
    checks.set(signal.commit, created);
    return created;
  };
  for (const upload of uploads) {
    const check = ensure(upload);
    check.coverage = newest(check.coverage, upload);
  }
  for (const run of runs) {
    const check = ensure(run);
    check.journey = newest(check.journey, run);
  }
  for (const preview of previews) {
    const check = ensure(preview);
    check.components = newest(check.components, preview);
  }
  for (const check of checks.values()) {
    check.missing = [
      ...(!check.coverage ? (["code"] as const) : []),
      ...(!check.journey ? (["journeys"] as const) : []),
      ...(!check.components ? (["components"] as const) : []),
    ];
    check.status =
      check.journey?.status === "failed" || (check.journey?.testsFailed ?? 0) > 0
        ? "failed"
        : check.missing.length === 0
          ? "ready"
          : "partial";
  }
  return [...checks.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
