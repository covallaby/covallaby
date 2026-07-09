import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  type PROverview,
  type RecordUploadInput,
  type RepoOverview,
  type Store,
  type Subscription,
  type UpdateReportInput,
  type UploadRow,
  accountOf,
  packReport,
  percentOf,
  unpackReport,
} from "../store.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS uploads (
  id INTEGER PRIMARY KEY,
  repo TEXT NOT NULL,
  branch TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  pr INTEGER,
  lines_covered INTEGER NOT NULL,
  lines_total INTEGER NOT NULL,
  files INTEGER NOT NULL,
  report BLOB NOT NULL,
  account TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_uploads_repo_branch_time
  ON uploads(repo, branch, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_uploads_account ON uploads(account);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS repo_tokens (repo TEXT PRIMARY KEY, token TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS subscriptions (
  account TEXT PRIMARY KEY, plan TEXT NOT NULL, status TEXT NOT NULL,
  stripe_customer TEXT, current_period_end TEXT
);
CREATE INDEX IF NOT EXISTS idx_uploads_repo_pr ON uploads(repo, pr) WHERE pr IS NOT NULL;
`;

interface RawRow {
  id: number;
  repo: string;
  branch: string;
  commit_sha: string;
  pr: number | null;
  lines_covered: number;
  lines_total: number;
  files: number;
  created_at: string;
}

function toRow(raw: RawRow): UploadRow {
  return {
    id: raw.id,
    repo: raw.repo,
    branch: raw.branch,
    commit: raw.commit_sha,
    pr: raw.pr,
    linesCovered: raw.lines_covered,
    linesTotal: raw.lines_total,
    percent: percentOf(raw.lines_covered, raw.lines_total),
    files: raw.files,
    createdAt: raw.created_at,
  };
}

const ROW_COLUMNS =
  "id, repo, branch, commit_sha, pr, lines_covered, lines_total, files, created_at";

/** Optional account scope for cross-repo queries (hosted multi-tenancy). */
function accountFilter(accounts?: string[]): { sub: string; params: string[] } {
  if (!accounts) return { sub: "", params: [] };
  if (accounts.length === 0) return { sub: "WHERE 1 = 0", params: [] };
  const placeholders = accounts.map(() => "?").join(", ");
  return { sub: `WHERE account IN (${placeholders})`, params: accounts };
}

export class SqliteStore implements Store {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(SCHEMA);
  }

  async recordUpload(input: RecordUploadInput): Promise<UploadRow> {
    const result = this.db
      .prepare(
        `INSERT INTO uploads (repo, branch, commit_sha, pr, lines_covered, lines_total, files, report, account)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.repo,
        input.branch,
        input.commit,
        input.pr,
        input.linesCovered,
        input.linesTotal,
        input.files,
        packReport(input.report),
        accountOf(input.repo),
      );
    const raw = this.db
      .prepare(`SELECT ${ROW_COLUMNS} FROM uploads WHERE id = ?`)
      .get(Number(result.lastInsertRowid)) as unknown as RawRow;
    return toRow(raw);
  }

  async listRepos(trendPoints: number, accounts?: string[]): Promise<RepoOverview[]> {
    const scope = accountFilter(accounts);
    const latest = this.db
      .prepare(
        `SELECT ${ROW_COLUMNS} FROM uploads
         WHERE id IN (SELECT MAX(id) FROM uploads ${scope.sub} GROUP BY repo)
         ORDER BY repo`,
      )
      .all(...scope.params) as unknown as RawRow[];
    return latest.map((raw) => {
      const row = toRow(raw);
      const trendRaw = this.db
        .prepare(
          `SELECT lines_covered, lines_total FROM uploads
           WHERE repo = ? AND branch = ?
           ORDER BY id DESC LIMIT ?`,
        )
        .all(row.repo, row.branch, trendPoints) as unknown as Array<{
        lines_covered: number;
        lines_total: number;
      }>;
      const trend = trendRaw.reverse().map((t) => percentOf(t.lines_covered, t.lines_total));
      return { repo: row.repo, latest: row, trend };
    });
  }

  async history(repo: string, branch: string, limit: number): Promise<UploadRow[]> {
    const rows = this.db
      .prepare(
        `SELECT ${ROW_COLUMNS} FROM uploads
         WHERE repo = ? AND branch = ? ORDER BY id DESC LIMIT ?`,
      )
      .all(repo, branch, limit) as unknown as RawRow[];
    return rows.map(toRow);
  }

  async recentUploads(limit: number, accounts?: string[]): Promise<UploadRow[]> {
    const scope = accountFilter(accounts);
    const rows = this.db
      .prepare(`SELECT ${ROW_COLUMNS} FROM uploads ${scope.sub} ORDER BY id DESC LIMIT ?`)
      .all(...scope.params, limit) as unknown as RawRow[];
    return rows.map(toRow);
  }

  async prevUpload(repo: string, branch: string, beforeId: number) {
    const raw = this.db
      .prepare(
        `SELECT ${ROW_COLUMNS}, report FROM uploads
         WHERE repo = ? AND branch = ? AND id < ? ORDER BY id DESC LIMIT 1`,
      )
      .get(repo, branch, beforeId) as unknown as (RawRow & { report: Uint8Array }) | undefined;
    if (!raw) return null;
    return { row: toRow(raw), report: unpackReport(raw.report) };
  }

  async branches(repo: string): Promise<string[]> {
    const rows = this.db
      .prepare(
        `SELECT branch, MAX(id) AS last FROM uploads WHERE repo = ?
         GROUP BY branch ORDER BY last DESC`,
      )
      .all(repo) as unknown as Array<{ branch: string }>;
    return rows.map((r) => r.branch);
  }

  async getUpload(id: number) {
    const raw = this.db
      .prepare(`SELECT ${ROW_COLUMNS}, report FROM uploads WHERE id = ?`)
      .get(id) as unknown as (RawRow & { report: Uint8Array }) | undefined;
    if (!raw) return null;
    return { row: toRow(raw), report: unpackReport(raw.report) };
  }

  async findByCommit(repo: string, commit: string) {
    const raw = this.db
      .prepare(
        `SELECT ${ROW_COLUMNS}, report FROM uploads
         WHERE repo = ? AND commit_sha = ? ORDER BY id DESC LIMIT 1`,
      )
      .get(repo, commit) as unknown as (RawRow & { report: Uint8Array }) | undefined;
    if (!raw) return null;
    return { row: toRow(raw), report: unpackReport(raw.report) };
  }

  async updateReport(id: number, patch: UpdateReportInput): Promise<UploadRow> {
    this.db
      .prepare(
        `UPDATE uploads SET report = ?, lines_covered = ?, lines_total = ?, files = ?
         WHERE id = ?`,
      )
      .run(packReport(patch.report), patch.linesCovered, patch.linesTotal, patch.files, id);
    const raw = this.db
      .prepare(`SELECT ${ROW_COLUMNS} FROM uploads WHERE id = ?`)
      .get(id) as unknown as RawRow;
    return toRow(raw);
  }

  async latest(repo: string, branch?: string): Promise<UploadRow | null> {
    const raw = (branch
      ? this.db
          .prepare(
            `SELECT ${ROW_COLUMNS} FROM uploads WHERE repo = ? AND branch = ?
               ORDER BY id DESC LIMIT 1`,
          )
          .get(repo, branch)
      : this.db
          .prepare(`SELECT ${ROW_COLUMNS} FROM uploads WHERE repo = ? ORDER BY id DESC LIMIT 1`)
          .get(repo)) as unknown as RawRow | undefined;
    return raw ? toRow(raw) : null;
  }

  async listPRs(repo: string, limit: number): Promise<PROverview[]> {
    const groups = this.db
      .prepare(
        `SELECT pr, MAX(id) AS latest_id, COUNT(*) AS uploads FROM uploads
         WHERE repo = ? AND pr IS NOT NULL GROUP BY pr ORDER BY latest_id DESC LIMIT ?`,
      )
      .all(repo, limit) as unknown as Array<{ pr: number; latest_id: number; uploads: number }>;
    return groups.map((g) => {
      const raw = this.db
        .prepare(`SELECT ${ROW_COLUMNS} FROM uploads WHERE id = ?`)
        .get(g.latest_id) as unknown as RawRow;
      return { pr: g.pr, latest: toRow(raw), uploads: g.uploads };
    });
  }

  async getRepoToken(repo: string): Promise<string | null> {
    const row = this.db.prepare("SELECT token FROM repo_tokens WHERE repo = ?").get(repo) as
      | { token: string }
      | undefined;
    return row?.token ?? null;
  }

  async setRepoToken(repo: string, token: string): Promise<void> {
    this.db
      .prepare(
        "INSERT INTO repo_tokens (repo, token) VALUES (?, ?) ON CONFLICT(repo) DO UPDATE SET token = excluded.token",
      )
      .run(repo, token);
  }

  async getSubscription(account: string): Promise<Subscription | null> {
    const r = this.db
      .prepare(
        "SELECT account, plan, status, stripe_customer, current_period_end FROM subscriptions WHERE account = ?",
      )
      .get(account) as
      | {
          account: string;
          plan: string;
          status: string;
          stripe_customer: string | null;
          current_period_end: string | null;
        }
      | undefined;
    return r
      ? {
          account: r.account,
          plan: r.plan as Subscription["plan"],
          status: r.status,
          stripeCustomer: r.stripe_customer,
          currentPeriodEnd: r.current_period_end,
        }
      : null;
  }

  async setSubscription(sub: Subscription): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO subscriptions (account, plan, status, stripe_customer, current_period_end)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(account) DO UPDATE SET plan=excluded.plan, status=excluded.status,
           stripe_customer=excluded.stripe_customer, current_period_end=excluded.current_period_end`,
      )
      .run(sub.account, sub.plan, sub.status, sub.stripeCustomer, sub.currentPeriodEnd);
  }

  async findSubscriptionByCustomer(stripeCustomer: string): Promise<Subscription | null> {
    const r = this.db
      .prepare(
        "SELECT account, plan, status, stripe_customer, current_period_end FROM subscriptions WHERE stripe_customer = ?",
      )
      .get(stripeCustomer) as
      | {
          account: string;
          plan: string;
          status: string;
          stripe_customer: string | null;
          current_period_end: string | null;
        }
      | undefined;
    return r
      ? {
          account: r.account,
          plan: r.plan as Subscription["plan"],
          status: r.status,
          stripeCustomer: r.stripe_customer,
          currentPeriodEnd: r.current_period_end,
        }
      : null;
  }

  async getMeta(key: string): Promise<string | null> {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  async setMeta(key: string, value: string): Promise<void> {
    this.db
      .prepare(
        "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(key, value);
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
