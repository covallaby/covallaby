import { repoRetentionKey } from "./retention.js";
import type { Store, TestRunRow, UploadRow } from "./store.js";

/**
 * Unified baseline resolution.
 *
 * Coverage comparisons ("upload vs base") and visual capture reviews ("new vs
 * baseline") both need the same answer: given a head snapshot, which earlier
 * snapshot is its baseline, and why? This module is the single place that
 * decides, so both features agree and both can explain themselves.
 *
 * The server does not record git ancestry — uploads and test runs carry a
 * branch and a commit SHA, but no parent SHAs, so a true merge-base walk is
 * impossible from stored data alone. CI can supply the merge-base explicitly
 * (the `base-sha` upload field); otherwise we approximate it with the best
 * available data. The fallback order, most precise first:
 *
 *   1. `base-sha` — the CI-provided base commit, when a snapshot exists for it
 *      (exact; covers squash merges and ephemeral merge commits).
 *   2. previous snapshot on the branch — when the head is itself on the base
 *      branch, its baseline is simply the snapshot before it.
 *   3. latest earlier snapshot on the base branch — the newest base-branch
 *      snapshot recorded before the head (a good stand-in for the merge-base,
 *      since CI uploads land in roughly topological order).
 *   4. latest snapshot on the base branch — even if it's newer than the head
 *      (better than nothing, and flagged as such).
 *   5. none — the base branch has no snapshots, or this is the first snapshot
 *      on it. The head becomes the future baseline.
 *
 * Visual baselines add an eligibility rule: only completed default-branch runs
 * that are auto-accepted (mainline builds) or human-approved may serve as a
 * baseline.
 */

/** A commit SHA as CI supplies it: abbreviated or full hex. */
export const SHA_RE = /^[0-9a-f]{7,64}$/i;

export type BaselineReason =
  | "base-sha"
  | "previous-on-branch"
  | "latest-on-base"
  | "newer-on-base"
  | "first-on-branch"
  | "base-branch-empty";

/** Why a baseline was (or wasn't) chosen — shipped verbatim to the UI. */
export interface BaselineInfo {
  reason: BaselineReason;
  /** Friendly one-liner, e.g. `Baseline: abc1234 (latest on main)`. */
  message: string;
  baseBranch: string;
  /** The baseline's commit SHA, or null when there is no baseline. */
  commit: string | null;
}

const short = (sha: string): string => sha.slice(0, 7);

function info(reason: BaselineReason, baseBranch: string, commit: string | null): BaselineInfo {
  const messages: Record<BaselineReason, string> = {
    "base-sha": commit ? `Baseline: ${short(commit)} (base commit provided by CI)` : "",
    "previous-on-branch": commit
      ? `Baseline: ${short(commit)} (previous build on ${baseBranch})`
      : "",
    "latest-on-base": commit ? `Baseline: ${short(commit)} (latest on ${baseBranch})` : "",
    "newer-on-base": commit
      ? `Baseline: ${short(commit)} (newest on ${baseBranch}, recorded after this build)`
      : "",
    "first-on-branch": `No baseline — first build on ${baseBranch}`,
    "base-branch-empty": `No baseline — ${baseBranch} has no builds yet`,
  };
  return { reason, message: messages[reason], baseBranch, commit };
}

/** The explicit per-repo default-branch override (set via the API). */
export const defaultBranchKey = (repo: string): string => `default-branch:${repo}`;

/** Prefer the conventional default branch, else whatever the store lists first. */
export function pickDefaultBranch(branches: string[], fallback = "main"): string {
  return branches.find((b) => b === "main" || b === "master") ?? branches[0] ?? fallback;
}

/**
 * The repo's default branch, best knowledge first: the explicit override set
 * via the API, then what the GitHub App recorded during sync (hosted mode),
 * then the conventional main/master heuristic over recorded upload branches.
 */
export async function resolveDefaultBranch(
  store: Store,
  repo: string,
  fallback = "main",
): Promise<string> {
  const configured = (await store.getMeta(defaultBranchKey(repo)))?.trim();
  if (configured) return configured;
  try {
    const synced = JSON.parse((await store.getMeta(repoRetentionKey(repo))) ?? "null") as {
      defaultBranch?: string;
    } | null;
    if (synced?.defaultBranch) return synced.defaultBranch;
  } catch {
    // corrupt sync state falls through to the heuristic
  }
  return pickDefaultBranch(await store.branches(repo), fallback);
}

/**
 * The coverage baseline for `head`: the upload its numbers should be judged
 * against. Follows the module-level fallback order.
 */
export async function resolveCoverageBaseline(
  store: Store,
  head: UploadRow,
  baseBranch: string,
): Promise<{ base: UploadRow | null; info: BaselineInfo }> {
  if (head.baseSha && SHA_RE.test(head.baseSha)) {
    const exact = await store.findByCommit(head.repo, head.baseSha);
    if (exact && exact.row.id !== head.id) {
      return { base: exact.row, info: info("base-sha", baseBranch, exact.row.commit) };
    }
  }
  if (head.branch === baseBranch) {
    const prev = await store.prevUpload(head.repo, baseBranch, head.id);
    return prev
      ? { base: prev.row, info: info("previous-on-branch", baseBranch, prev.row.commit) }
      : { base: null, info: info("first-on-branch", baseBranch, null) };
  }
  const earlier = await store.prevUpload(head.repo, baseBranch, head.id);
  if (earlier) {
    return { base: earlier.row, info: info("latest-on-base", baseBranch, earlier.row.commit) };
  }
  const newest = await store.latest(head.repo, baseBranch);
  if (newest) {
    return { base: newest, info: info("newer-on-base", baseBranch, newest.commit) };
  }
  return { base: null, info: info("base-branch-empty", baseBranch, null) };
}

/** May this run serve as a visual baseline? Complete and accepted, on the base branch. */
export function baselineEligible(run: TestRunRow, baseBranch: string): boolean {
  return (
    run.status === "complete" &&
    run.branch === baseBranch &&
    (run.reviewState === "auto-accepted" || run.reviewState === "approved")
  );
}

/**
 * The visual baseline for `run`: the earlier capture set its screenshots
 * should be diffed against. Same fallback order as coverage, plus the
 * eligibility rule above.
 */
export async function resolveVisualBaseline(
  store: Store,
  run: TestRunRow,
  baseBranch: string,
): Promise<{ baseline: TestRunRow | null; info: BaselineInfo }> {
  const candidates = store.listTestRuns
    ? await store.listTestRuns(run.repo, 100, run.framework)
    : [];
  if (run.baseSha && SHA_RE.test(run.baseSha)) {
    const exact = candidates.find(
      (c) => c.id !== run.id && c.status === "complete" && c.commit === run.baseSha,
    );
    if (exact) return { baseline: exact, info: info("base-sha", baseBranch, exact.commit) };
  }
  // listTestRuns is newest-first, so the first eligible earlier run is the latest.
  const eligible = candidates.find((c) => c.id < run.id && baselineEligible(c, baseBranch));
  if (eligible) {
    const reason = run.branch === baseBranch ? "previous-on-branch" : "latest-on-base";
    return { baseline: eligible, info: info(reason, baseBranch, eligible.commit) };
  }
  if (run.branch === baseBranch) {
    return { baseline: null, info: info("first-on-branch", baseBranch, null) };
  }
  return { baseline: null, info: info("base-branch-empty", baseBranch, null) };
}
