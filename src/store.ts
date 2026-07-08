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

/**
 * The storage interface both drivers implement. Async throughout — SQLite is
 * synchronous underneath, Postgres isn't, and callers shouldn't care.
 */
export interface Store {
  recordUpload(input: RecordUploadInput): Promise<UploadRow>;
  listRepos(trendPoints: number): Promise<RepoOverview[]>;
  history(repo: string, branch: string, limit: number): Promise<UploadRow[]>;
  /** Latest uploads across every repo, newest first. */
  recentUploads(limit: number): Promise<UploadRow[]>;
  /** The upload immediately before `beforeId` on the same repo+branch. */
  prevUpload(
    repo: string,
    branch: string,
    beforeId: number,
  ): Promise<{ row: UploadRow; report: import("./vendor/model.js").CoverageReport } | null>;
  branches(repo: string): Promise<string[]>;
  getUpload(id: number): Promise<{ row: UploadRow; report: CoverageReport } | null>;
  latest(repo: string, branch?: string): Promise<UploadRow | null>;
  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string): Promise<void>;
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
