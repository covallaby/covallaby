import { gunzipSync, gzipSync } from "node:zlib";
import type { CoverageReport } from "./vendor/model.js";

/** One coverage upload, denormalized for fast history queries. */
export interface UploadRow {
  id: number;
  repo: string;
  branch: string;
  commit: string;
  pr: number | null;
  linesCovered: number;
  linesTotal: number;
  /** 0–100 or null when nothing was coverable. */
  percent: number | null;
  files: number;
  /** CI-supplied base commit (merge-base) for baseline resolution, or null. */
  baseSha: string | null;
  createdAt: string;
}

export interface RepoOverview {
  repo: string;
  latest: UploadRow;
  /** Most recent default-branch percents, oldest first, for sparklines. */
  trend: Array<number | null>;
}

export interface RecordUploadInput {
  repo: string;
  branch: string;
  commit: string;
  pr: number | null;
  report: CoverageReport;
  linesCovered: number;
  linesTotal: number;
  files: number;
  /** Optional CI-supplied base commit (merge-base) for baseline resolution. */
  baseSha?: string | null;
}

/** The report + recomputed counters written back when merging sharded uploads. */
export interface UpdateReportInput {
  report: CoverageReport;
  linesCovered: number;
  linesTotal: number;
  files: number;
}

/**
 * The storage interface both drivers implement. Async throughout — SQLite is
 * synchronous underneath, Postgres isn't, and callers shouldn't care.
 */
export interface PROverview {
  pr: number;
  latest: UploadRow;
  uploads: number;
}

/** The tenant boundary: the GitHub owner of a repo. */
export function accountOf(repo: string): string {
  return repo.split("/")[0] ?? repo;
}

export type Plan = "free" | "pro";

export interface Subscription {
  account: string;
  plan: Plan;
  status: string; // stripe status: active, past_due, canceled, …
  stripeCustomer: string | null;
  currentPeriodEnd: string | null;
}

export type TestRunStatus = "uploading" | "complete" | "failed";
/**
 * Review verdict for a visual capture run. "auto-accepted" is the mainline
 * state — default-branch builds skip review and are immediately
 * baseline-eligible — kept distinct from a human "approved" on purpose.
 */
export type ReviewState = "pending" | "approved" | "rejected" | "auto-accepted";
export type TestArtifactKind = "video" | "screenshot" | "trace" | "report" | "results" | "other";

export interface TestRunRow {
  id: number;
  repo: string;
  branch: string;
  commit: string;
  pr: number | null;
  framework: string;
  status: TestRunStatus;
  testsPassed: number;
  testsFailed: number;
  testsSkipped: number;
  durationMs: number;
  /** CI-supplied base commit (merge-base) for visual baseline resolution. */
  baseSha: string | null;
  reviewState: ReviewState;
  /**
   * Denormalized count of screenshot artifacts on the run. Written on create;
   * null on rows recorded before the column existed (backfilled lazily on
   * read), so list endpoints never need the per-run artifact N+1.
   */
  imageCount: number | null;
  createdAt: string;
  completedAt: string | null;
}

export interface TestArtifactRow {
  id: number;
  runId: number;
  name: string;
  kind: TestArtifactKind;
  contentType: string;
  sizeBytes: number;
  objectKey: string;
  testName: string | null;
  createdAt: string;
}

export interface CreateTestRunInput {
  repo: string;
  branch: string;
  commit: string;
  pr: number | null;
  framework: string;
  testsPassed: number;
  testsFailed: number;
  testsSkipped: number;
  durationMs: number;
  /** Optional CI-supplied base commit (merge-base) for baseline resolution. */
  baseSha?: string | null;
  /** Defaults to "pending"; default-branch runs are created "auto-accepted". */
  reviewState?: ReviewState;
  /** Number of screenshot artifacts in the run's manifest, when known. */
  imageCount?: number | null;
}

/**
 * A human verdict on one story's visual change within a run. Pending is the
 * absence of a row, so the table only ever holds explicit approve/reject
 * decisions. The (baselineSha256, sha256) pair records exactly which pixels
 * the verdict covered: if the diff changes, the stored verdict no longer
 * applies (Percy semantics), and an identical pair lets an approval carry
 * over to later runs.
 */
export type CaptureReviewState = "approved" | "rejected";

export interface CaptureReviewRow {
  id: number;
  runId: number;
  repo: string;
  /** The story id the verdict is keyed to within the run. */
  storyId: string;
  state: CaptureReviewState;
  /** Hash of the baseline screenshot the verdict was made against (null for new stories). */
  baselineSha256: string | null;
  /** Hash of this run's screenshot (null for removed stories). */
  sha256: string | null;
  /** Who reviewed (hosted session login), or null for token/self-hosted reviews. */
  reviewedBy: string | null;
  reviewedAt: string;
}

export interface SetCaptureReviewInput {
  runId: number;
  repo: string;
  storyId: string;
  state: CaptureReviewState;
  baselineSha256: string | null;
  sha256: string | null;
  reviewedBy: string | null;
}

/** Cached pixel comparison for one capture in one run. */
export interface CaptureComparisonRow {
  runId: number;
  storyId: string;
  changedPixels: number;
  totalPixels: number;
  changeRatio: number;
}

/**
 * A persistent policy for a story whose pixels are intentionally variable.
 * `allowed` documents understood variance; `flaky` calls out test debt. Both
 * require an explicit tolerance before a future diff can pass automatically.
 */
export type CaptureReviewRuleState = "allowed" | "flaky";

export interface CaptureReviewRuleRow {
  repo: string;
  storyId: string;
  state: CaptureReviewRuleState;
  /** Maximum changed-pixel ratio accepted automatically (0–1). */
  toleranceRatio: number;
  note: string | null;
  reviewedBy: string | null;
  reviewedAt: string;
}

export interface SetCaptureReviewRuleInput {
  repo: string;
  storyId: string;
  state: CaptureReviewRuleState;
  toleranceRatio: number;
  note: string | null;
  reviewedBy: string | null;
}

export interface CreateTestArtifactInput {
  runId: number;
  name: string;
  kind: TestArtifactKind;
  contentType: string;
  sizeBytes: number;
  objectKey: string;
  testName: string | null;
}

export interface Store {
  recordUpload(input: RecordUploadInput): Promise<UploadRow>;
  /** The latest upload for an exact repo+commit, with its report — the merge target. */
  findByCommit(
    repo: string,
    commit: string,
  ): Promise<{ row: UploadRow; report: CoverageReport } | null>;
  /** Replace an upload's report + counters in place (sharded-upload accumulation). */
  updateReport(id: number, patch: UpdateReportInput): Promise<UploadRow>;
  /**
   * Cross-repo overview. `accounts` (hosted mode) scopes to those owners;
   * omit for the self-hosted single-tenant view (all repos).
   */
  listRepos(trendPoints: number, accounts?: string[]): Promise<RepoOverview[]>;
  history(repo: string, branch: string, limit: number): Promise<UploadRow[]>;
  /** Latest uploads across every repo, newest first. `accounts` scopes them. */
  recentUploads(limit: number, accounts?: string[]): Promise<UploadRow[]>;
  /** The upload immediately before `beforeId` on the same repo+branch. */
  prevUpload(
    repo: string,
    branch: string,
    beforeId: number,
  ): Promise<{ row: UploadRow; report: import("./vendor/model.js").CoverageReport } | null>;
  /**
   * The uploads immediately before and after `id` on the same repo+branch,
   * without their reports — lateral prev/next navigation only, so the lookup
   * stays on the repo+branch index and never touches the report blob.
   */
  uploadNeighbors(
    repo: string,
    branch: string,
    id: number,
  ): Promise<{ prev: UploadRow | null; next: UploadRow | null }>;
  branches(repo: string): Promise<string[]>;
  getUpload(id: number): Promise<{ row: UploadRow; report: CoverageReport } | null>;
  latest(repo: string, branch?: string): Promise<UploadRow | null>;
  /** PRs that have uploads, most recently active first. */
  listPRs(repo: string, limit: number): Promise<PROverview[]>;
  getRepoToken(repo: string): Promise<string | null>;
  setRepoToken(repo: string, token: string): Promise<void>;
  /** Hosted-tier billing (unused by the self-hosted server). */
  getSubscription(account: string): Promise<Subscription | null>;
  setSubscription(sub: Subscription): Promise<void>;
  findSubscriptionByCustomer(stripeCustomer: string): Promise<Subscription | null>;
  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string): Promise<void>;
  /** Browser-test playback metadata. Optional for runtimes without object storage (currently D1). */
  createTestRun?(input: CreateTestRunInput): Promise<TestRunRow>;
  createTestArtifact?(input: CreateTestArtifactInput): Promise<TestArtifactRow>;
  completeTestRun?(id: number): Promise<TestRunRow | null>;
  failTestRun?(id: number): Promise<void>;
  getTestRun?(id: number): Promise<{ run: TestRunRow; artifacts: TestArtifactRow[] } | null>;
  getTestRunRow?(id: number): Promise<TestRunRow | null>;
  getTestArtifactByName?(runId: number, name: string): Promise<TestArtifactRow | null>;
  listTestRuns?(repo: string, limit: number, framework?: string): Promise<TestRunRow[]>;
  /**
   * Latest test runs across every repo, newest first — the activity feed's
   * runs side, account-scoped in SQL exactly like recentUploads. Never
   * selects artifact rows or blobs. Optional: runtimes without test-run
   * support (currently D1) leave it undefined and the feed degrades to
   * uploads-only.
   */
  recentRuns?(limit: number, accounts?: string[]): Promise<TestRunRow[]>;
  /** Lazy backfill for the denormalized screenshot count on pre-column rows. */
  setTestRunImageCount?(id: number, imageCount: number): Promise<void>;
  /** The runs immediately before and after `id` for the same repo+framework — lateral navigation. */
  testRunNeighbors?(
    repo: string,
    framework: string,
    id: number,
  ): Promise<{ prev: TestRunRow | null; next: TestRunRow | null }>;
  /** Record a human review verdict on a visual capture run. */
  setTestRunReview?(id: number, state: ReviewState): Promise<TestRunRow | null>;
  /** Upsert a per-story review verdict (keyed by run + story). */
  setCaptureReview?(input: SetCaptureReviewInput): Promise<CaptureReviewRow>;
  /** Return a story to pending by removing its verdict row. */
  clearCaptureReview?(runId: number, storyId: string): Promise<void>;
  /** All per-story verdicts recorded on a run. */
  listCaptureReviews?(runId: number): Promise<CaptureReviewRow[]>;
  /**
   * The most recent verdict anywhere else in the repo on this exact
   * (baseline, current) hash pair — the carry-over lookup. Null hashes match
   * null (new/removed stories key on their single hash).
   */
  findCaptureReviewByPair?(
    repo: string,
    baselineSha256: string | null,
    sha256: string | null,
    excludeRunId: number,
  ): Promise<CaptureReviewRow | null>;
  /** Cached changed-pixel measurements, populated when a preview completes. */
  listCaptureComparisons?(runId: number): Promise<CaptureComparisonRow[]>;
  setCaptureComparison?(comparison: CaptureComparisonRow): Promise<void>;
  /** Persist a non-blocking rule for a story across future pixel changes. */
  setCaptureReviewRule?(input: SetCaptureReviewRuleInput): Promise<CaptureReviewRuleRow>;
  /** Remove a story's persistent allowed/flaky rule. */
  clearCaptureReviewRule?(repo: string, storyId: string): Promise<void>;
  /** Load all persistent visual-review rules for a repository. */
  listCaptureReviewRules?(repo: string): Promise<CaptureReviewRuleRow[]>;
  deleteTestRun?(id: number): Promise<void>;
  close(): Promise<void>;
}

export function percentOf(covered: number, total: number): number | null {
  return total === 0 ? null : (covered / total) * 100;
}

export function packReport(report: CoverageReport): Uint8Array {
  return gzipSync(JSON.stringify(report));
}

export function unpackReport(blob: Uint8Array): CoverageReport {
  return JSON.parse(gunzipSync(blob).toString("utf8")) as CoverageReport;
}

/** Pick a driver from the environment: DATABASE_URL → Postgres, else SQLite. */
export async function openStore(env: NodeJS.ProcessEnv = process.env): Promise<Store> {
  const url = env.DATABASE_URL?.trim();
  if (url && /^postgres(ql)?:\/\//.test(url)) {
    const { PostgresStore } = await import("./store/postgres.js");
    return PostgresStore.connect(url);
  }
  const { SqliteStore } = await import("./store/sqlite.js");
  return new SqliteStore(env.COVALLABY_DB ?? "data/covallaby.db");
}
