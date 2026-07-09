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

/**
 * The Cloudflare D1 driver. D1 is SQLite at the edge, so the SQL is identical
 * to the node:sqlite driver — only the client shape differs (async
 * prepare().bind().all()/first()/run(), no synchronous constructor). Schema is
 * ensured lazily once per isolate, since a Worker can't run DDL at import time.
 *
 * The D1 types below are the exact subset we use, so the adapter is testable
 * against any object matching them (a node:sqlite-backed fake in tests, the
 * real `env.DB` on Workers) without pulling in Cloudflare's ambient types.
 */
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<{ meta: { last_row_id: number } }>;
}
export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  exec(sql: string): Promise<unknown>;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS uploads (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     repo TEXT NOT NULL, branch TEXT NOT NULL, commit_sha TEXT NOT NULL, pr INTEGER,
     lines_covered INTEGER NOT NULL, lines_total INTEGER NOT NULL, files INTEGER NOT NULL,
     report BLOB NOT NULL, account TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`,
  "CREATE INDEX IF NOT EXISTS idx_uploads_repo_branch_time ON uploads(repo, branch, created_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_uploads_account ON uploads(account)",
  "CREATE INDEX IF NOT EXISTS idx_uploads_repo_pr ON uploads(repo, pr) WHERE pr IS NOT NULL",
  "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS repo_tokens (repo TEXT PRIMARY KEY, token TEXT NOT NULL)",
  `CREATE TABLE IF NOT EXISTS subscriptions (
     account TEXT PRIMARY KEY, plan TEXT NOT NULL, status TEXT NOT NULL,
     stripe_customer TEXT, current_period_end TEXT)`,
];

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

type SubRow = {
  account: string;
  plan: string;
  status: string;
  stripe_customer: string | null;
  current_period_end: string | null;
};
function toSub(r: SubRow): Subscription {
  return {
    account: r.account,
    plan: r.plan as Subscription["plan"],
    status: r.status,
    stripeCustomer: r.stripe_customer,
    currentPeriodEnd: r.current_period_end,
  };
}

const ROW_COLUMNS =
  "id, repo, branch, commit_sha, pr, lines_covered, lines_total, files, created_at";

/** D1 returns BLOB as ArrayBuffer; normalize to a Buffer for unpackReport. */
function asReport(blob: ArrayBuffer | Uint8Array): ReturnType<typeof unpackReport> {
  return unpackReport(blob instanceof Uint8Array ? blob : new Uint8Array(blob));
}

export class D1Store implements Store {
  private ready: Promise<void> | null = null;

  constructor(private readonly db: D1Database) {}

  /** Idempotent schema, ensured once per isolate. */
  private ensure(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        for (const stmt of SCHEMA) await this.db.prepare(stmt).run();
      })();
    }
    return this.ready;
  }

  async recordUpload(input: RecordUploadInput): Promise<UploadRow> {
    await this.ensure();
    const res = await this.db
      .prepare(
        `INSERT INTO uploads (repo, branch, commit_sha, pr, lines_covered, lines_total, files, report, account)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.repo,
        input.branch,
        input.commit,
        input.pr,
        input.linesCovered,
        input.linesTotal,
        input.files,
        packReport(input.report),
        accountOf(input.repo),
      )
      .run();
    const raw = await this.db
      .prepare(`SELECT ${ROW_COLUMNS} FROM uploads WHERE id = ?`)
      .bind(res.meta.last_row_id)
      .first<RawRow>();
    return toRow(raw as RawRow);
  }

  async listRepos(trendPoints: number, accounts?: string[]): Promise<RepoOverview[]> {
    await this.ensure();
    const scope = accountClause(accounts);
    const { results: latest } = await this.db
      .prepare(
        `SELECT ${ROW_COLUMNS} FROM uploads
         WHERE id IN (SELECT MAX(id) FROM uploads ${scope.sql} GROUP BY repo)
         ORDER BY repo`,
      )
      .bind(...scope.params)
      .all<RawRow>();
    const out: RepoOverview[] = [];
    for (const raw of latest) {
      const row = toRow(raw);
      const { results: trendRaw } = await this.db
        .prepare(
          `SELECT lines_covered, lines_total FROM uploads
           WHERE repo = ? AND branch = ? ORDER BY id DESC LIMIT ?`,
        )
        .bind(row.repo, row.branch, trendPoints)
        .all<{ lines_covered: number; lines_total: number }>();
      const trend = trendRaw.reverse().map((t) => percentOf(t.lines_covered, t.lines_total));
      out.push({ repo: row.repo, latest: row, trend });
    }
    return out;
  }

  async history(repo: string, branch: string, limit: number): Promise<UploadRow[]> {
    await this.ensure();
    const { results } = await this.db
      .prepare(
        `SELECT ${ROW_COLUMNS} FROM uploads WHERE repo = ? AND branch = ? ORDER BY id DESC LIMIT ?`,
      )
      .bind(repo, branch, limit)
      .all<RawRow>();
    return results.map(toRow);
  }

  async recentUploads(limit: number, accounts?: string[]): Promise<UploadRow[]> {
    await this.ensure();
    const scope = accountClause(accounts);
    const { results } = await this.db
      .prepare(`SELECT ${ROW_COLUMNS} FROM uploads ${scope.sql} ORDER BY id DESC LIMIT ?`)
      .bind(...scope.params, limit)
      .all<RawRow>();
    return results.map(toRow);
  }

  async prevUpload(repo: string, branch: string, beforeId: number) {
    await this.ensure();
    const raw = await this.db
      .prepare(
        `SELECT ${ROW_COLUMNS}, report FROM uploads
         WHERE repo = ? AND branch = ? AND id < ? ORDER BY id DESC LIMIT 1`,
      )
      .bind(repo, branch, beforeId)
      .first<RawRow & { report: ArrayBuffer }>();
    if (!raw) return null;
    return { row: toRow(raw), report: asReport(raw.report) };
  }

  async branches(repo: string): Promise<string[]> {
    await this.ensure();
    const { results } = await this.db
      .prepare(
        "SELECT branch, MAX(id) AS last FROM uploads WHERE repo = ? GROUP BY branch ORDER BY last DESC",
      )
      .bind(repo)
      .all<{ branch: string }>();
    return results.map((r) => r.branch);
  }

  async getUpload(id: number) {
    await this.ensure();
    const raw = await this.db
      .prepare(`SELECT ${ROW_COLUMNS}, report FROM uploads WHERE id = ?`)
      .bind(id)
      .first<RawRow & { report: ArrayBuffer }>();
    if (!raw) return null;
    return { row: toRow(raw), report: asReport(raw.report) };
  }

  async findByCommit(repo: string, commit: string) {
    await this.ensure();
    const raw = await this.db
      .prepare(
        `SELECT ${ROW_COLUMNS}, report FROM uploads
         WHERE repo = ? AND commit_sha = ? ORDER BY id DESC LIMIT 1`,
      )
      .bind(repo, commit)
      .first<RawRow & { report: ArrayBuffer }>();
    if (!raw) return null;
    return { row: toRow(raw), report: asReport(raw.report) };
  }

  async updateReport(id: number, patch: UpdateReportInput): Promise<UploadRow> {
    await this.ensure();
    await this.db
      .prepare(
        `UPDATE uploads SET report = ?, lines_covered = ?, lines_total = ?, files = ?
         WHERE id = ?`,
      )
      .bind(packReport(patch.report), patch.linesCovered, patch.linesTotal, patch.files, id)
      .run();
    const raw = await this.db
      .prepare(`SELECT ${ROW_COLUMNS} FROM uploads WHERE id = ?`)
      .bind(id)
      .first<RawRow>();
    return toRow(raw!);
  }

  async latest(repo: string, branch?: string): Promise<UploadRow | null> {
    await this.ensure();
    const raw = branch
      ? await this.db
          .prepare(
            `SELECT ${ROW_COLUMNS} FROM uploads WHERE repo = ? AND branch = ? ORDER BY id DESC LIMIT 1`,
          )
          .bind(repo, branch)
          .first<RawRow>()
      : await this.db
          .prepare(`SELECT ${ROW_COLUMNS} FROM uploads WHERE repo = ? ORDER BY id DESC LIMIT 1`)
          .bind(repo)
          .first<RawRow>();
    return raw ? toRow(raw) : null;
  }

  async listPRs(repo: string, limit: number): Promise<PROverview[]> {
    await this.ensure();
    const { results: groups } = await this.db
      .prepare(
        `SELECT pr, MAX(id) AS latest_id, COUNT(*) AS uploads FROM uploads
         WHERE repo = ? AND pr IS NOT NULL GROUP BY pr ORDER BY latest_id DESC LIMIT ?`,
      )
      .bind(repo, limit)
      .all<{ pr: number; latest_id: number; uploads: number }>();
    const out: PROverview[] = [];
    for (const g of groups) {
      const raw = await this.db
        .prepare(`SELECT ${ROW_COLUMNS} FROM uploads WHERE id = ?`)
        .bind(g.latest_id)
        .first<RawRow>();
      out.push({ pr: g.pr, latest: toRow(raw as RawRow), uploads: g.uploads });
    }
    return out;
  }

  async getRepoToken(repo: string): Promise<string | null> {
    await this.ensure();
    const row = await this.db
      .prepare("SELECT token FROM repo_tokens WHERE repo = ?")
      .bind(repo)
      .first<{ token: string }>();
    return row?.token ?? null;
  }

  async setRepoToken(repo: string, token: string): Promise<void> {
    await this.ensure();
    await this.db
      .prepare(
        "INSERT INTO repo_tokens (repo, token) VALUES (?, ?) ON CONFLICT(repo) DO UPDATE SET token = excluded.token",
      )
      .bind(repo, token)
      .run();
  }

  async getSubscription(account: string): Promise<Subscription | null> {
    await this.ensure();
    const r = await this.db
      .prepare(
        "SELECT account, plan, status, stripe_customer, current_period_end FROM subscriptions WHERE account = ?",
      )
      .bind(account)
      .first<SubRow>();
    return r ? toSub(r) : null;
  }

  async setSubscription(sub: Subscription): Promise<void> {
    await this.ensure();
    await this.db
      .prepare(
        `INSERT INTO subscriptions (account, plan, status, stripe_customer, current_period_end)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(account) DO UPDATE SET plan=excluded.plan, status=excluded.status,
           stripe_customer=excluded.stripe_customer, current_period_end=excluded.current_period_end`,
      )
      .bind(sub.account, sub.plan, sub.status, sub.stripeCustomer, sub.currentPeriodEnd)
      .run();
  }

  async findSubscriptionByCustomer(stripeCustomer: string): Promise<Subscription | null> {
    await this.ensure();
    const r = await this.db
      .prepare(
        "SELECT account, plan, status, stripe_customer, current_period_end FROM subscriptions WHERE stripe_customer = ?",
      )
      .bind(stripeCustomer)
      .first<SubRow>();
    return r ? toSub(r) : null;
  }

  async getMeta(key: string): Promise<string | null> {
    await this.ensure();
    const row = await this.db
      .prepare("SELECT value FROM meta WHERE key = ?")
      .bind(key)
      .first<{ value: string }>();
    return row?.value ?? null;
  }

  async setMeta(key: string, value: string): Promise<void> {
    await this.ensure();
    await this.db
      .prepare(
        "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .bind(key, value)
      .run();
  }

  async close(): Promise<void> {
    // D1 has no connection to close.
  }
}

/** Optional account scope for cross-repo queries (hosted multi-tenancy). */
function accountClause(accounts?: string[]): { sql: string; params: string[] } {
  if (!accounts) return { sql: "", params: [] };
  if (accounts.length === 0) return { sql: "WHERE 1 = 0", params: [] };
  return { sql: `WHERE account IN (${accounts.map(() => "?").join(", ")})`, params: accounts };
}
