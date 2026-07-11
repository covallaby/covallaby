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
  listTestRuns?(repo: string, limit: number): Promise<TestRunRow[]>;
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
