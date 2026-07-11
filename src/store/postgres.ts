import postgres from "postgres";
import {
  type CreateTestArtifactInput,
  type CreateTestRunInput,
  type PROverview,
  type RecordUploadInput,
  type RepoOverview,
  type Store,
  type Subscription,
  type TestArtifactRow,
  type TestRunRow,
  type UpdateReportInput,
  type UploadRow,
  accountOf,
  packReport,
  percentOf,
  unpackReport,
} from "../store.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS uploads (
  id BIGSERIAL PRIMARY KEY,
  repo TEXT NOT NULL,
  branch TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  pr INTEGER,
  lines_covered INTEGER NOT NULL,
  lines_total INTEGER NOT NULL,
  files INTEGER NOT NULL,
  report BYTEA NOT NULL,
  account TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
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
CREATE TABLE IF NOT EXISTS test_runs (
  id BIGSERIAL PRIMARY KEY, repo TEXT NOT NULL, branch TEXT NOT NULL, commit_sha TEXT NOT NULL,
  pr INTEGER, framework TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'uploading',
  tests_passed INTEGER NOT NULL DEFAULT 0, tests_failed INTEGER NOT NULL DEFAULT 0,
  tests_skipped INTEGER NOT NULL DEFAULT 0, duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_test_runs_repo_time ON test_runs(repo, created_at DESC);
CREATE TABLE IF NOT EXISTS test_artifacts (
  id BIGSERIAL PRIMARY KEY, run_id BIGINT NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
  name TEXT NOT NULL, kind TEXT NOT NULL, content_type TEXT NOT NULL, size_bytes BIGINT NOT NULL,
  object_key TEXT NOT NULL UNIQUE, test_name TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_test_artifacts_run ON test_artifacts(run_id);
`;

interface RawRow {
  id: string | number;
  repo: string;
  branch: string;
  commit_sha: string;
  pr: number | null;
  lines_covered: number;
  lines_total: number;
  files: number;
  created_at: Date | string;
}

function toRow(raw: RawRow): UploadRow {
  return {
    id: Number(raw.id),
    repo: raw.repo,
    branch: raw.branch,
    commit: raw.commit_sha,
    pr: raw.pr,
    linesCovered: raw.lines_covered,
    linesTotal: raw.lines_total,
    percent: percentOf(raw.lines_covered, raw.lines_total),
    files: raw.files,
    createdAt: raw.created_at instanceof Date ? raw.created_at.toISOString() : raw.created_at,
  };
}

interface RawTestRun {
  id: string | number;
  repo: string;
  branch: string;
  commit_sha: string;
  pr: number | null;
  framework: string;
  status: TestRunRow["status"];
  tests_passed: number;
  tests_failed: number;
  tests_skipped: number;
  duration_ms: number;
  created_at: Date | string;
  completed_at: Date | string | null;
}

interface RawArtifact {
  id: string | number;
  run_id: string | number;
  name: string;
  kind: TestArtifactRow["kind"];
  content_type: string;
  size_bytes: string | number;
  object_key: string;
  test_name: string | null;
  created_at: Date | string;
}

const iso = (value: Date | string): string => (value instanceof Date ? value.toISOString() : value);
const toTestRun = (r: RawTestRun): TestRunRow => ({
  id: Number(r.id),
  repo: r.repo,
  branch: r.branch,
  commit: r.commit_sha,
  pr: r.pr,
  framework: r.framework,
  status: r.status,
  testsPassed: r.tests_passed,
  testsFailed: r.tests_failed,
  testsSkipped: r.tests_skipped,
  durationMs: r.duration_ms,
  createdAt: iso(r.created_at),
  completedAt: r.completed_at ? iso(r.completed_at) : null,
});
const toArtifact = (r: RawArtifact): TestArtifactRow => ({
  id: Number(r.id),
  runId: Number(r.run_id),
  name: r.name,
  kind: r.kind,
  contentType: r.content_type,
  sizeBytes: Number(r.size_bytes),
  objectKey: r.object_key,
  testName: r.test_name,
  createdAt: iso(r.created_at),
});

export class PostgresStore implements Store {
  private constructor(private readonly sql: postgres.Sql) {}

  static async connect(url: string): Promise<PostgresStore> {
    // prepare:false keeps us compatible with transaction-pooling front-ends
    // (PgBouncer, Fly Managed Postgres, Supabase's pooler); the workload is
    // low-QPS, so losing server-side prepared statements costs nothing.
    const sql = postgres(url, { max: 5, prepare: false, onnotice: () => {} });
    await sql.unsafe(SCHEMA);
    return new PostgresStore(sql);
  }

  async recordUpload(input: RecordUploadInput): Promise<UploadRow> {
    const [raw] = await this.sql<RawRow[]>`
      INSERT INTO uploads (repo, branch, commit_sha, pr, lines_covered, lines_total, files, report, account)
      VALUES (${input.repo}, ${input.branch}, ${input.commit}, ${input.pr},
              ${input.linesCovered}, ${input.linesTotal}, ${input.files},
              ${Buffer.from(packReport(input.report))}, ${accountOf(input.repo)})
      RETURNING id, repo, branch, commit_sha, pr, lines_covered, lines_total, files, created_at`;
    return toRow(raw!);
  }

  async listRepos(trendPoints: number, accounts?: string[]): Promise<RepoOverview[]> {
    const sub =
      accounts === undefined
        ? this.sql``
        : accounts.length === 0
          ? this.sql`WHERE false`
          : this.sql`WHERE account = ANY(${accounts})`;
    const latest = await this.sql<RawRow[]>`
      SELECT id, repo, branch, commit_sha, pr, lines_covered, lines_total, files, created_at
      FROM uploads WHERE id IN (
        SELECT DISTINCT ON (repo) id FROM uploads ${sub}
        ORDER BY repo, (branch IN ('main', 'master')) DESC, id DESC
      )
      ORDER BY repo`;
    const overviews: RepoOverview[] = [];
    for (const raw of latest) {
      const row = toRow(raw);
      const trendRaw = await this.sql<Array<{ lines_covered: number; lines_total: number }>>`
        SELECT lines_covered, lines_total FROM uploads
        WHERE repo = ${row.repo} AND branch = ${row.branch}
        ORDER BY id DESC LIMIT ${trendPoints}`;
      const trend = [...trendRaw].reverse().map((t) => percentOf(t.lines_covered, t.lines_total));
      overviews.push({ repo: row.repo, latest: row, trend });
    }
    return overviews;
  }

  async history(repo: string, branch: string, limit: number): Promise<UploadRow[]> {
    const rows = await this.sql<RawRow[]>`
      SELECT id, repo, branch, commit_sha, pr, lines_covered, lines_total, files, created_at
      FROM uploads WHERE repo = ${repo} AND branch = ${branch}
      ORDER BY id DESC LIMIT ${limit}`;
    return rows.map(toRow);
  }

  async recentUploads(limit: number, accounts?: string[]): Promise<UploadRow[]> {
    const sub =
      accounts === undefined
        ? this.sql``
        : accounts.length === 0
          ? this.sql`WHERE false`
          : this.sql`WHERE account = ANY(${accounts})`;
    const rows = await this.sql<RawRow[]>`
      SELECT id, repo, branch, commit_sha, pr, lines_covered, lines_total, files, created_at
      FROM uploads ${sub} ORDER BY id DESC LIMIT ${limit}`;
    return rows.map(toRow);
  }

  async prevUpload(repo: string, branch: string, beforeId: number) {
    const [raw] = await this.sql<Array<RawRow & { report: Buffer }>>`
      SELECT id, repo, branch, commit_sha, pr, lines_covered, lines_total, files, created_at, report
      FROM uploads WHERE repo = ${repo} AND branch = ${branch} AND id < ${beforeId}
      ORDER BY id DESC LIMIT 1`;
    if (!raw) return null;
    return { row: toRow(raw), report: unpackReport(raw.report) };
  }

  async branches(repo: string): Promise<string[]> {
    const rows = await this.sql<Array<{ branch: string }>>`
      SELECT branch, MAX(id) AS last FROM uploads WHERE repo = ${repo}
      GROUP BY branch ORDER BY last DESC`;
    return rows.map((r) => r.branch);
  }

  async getUpload(id: number) {
    const [raw] = await this.sql<Array<RawRow & { report: Buffer }>>`
      SELECT id, repo, branch, commit_sha, pr, lines_covered, lines_total, files, created_at, report
      FROM uploads WHERE id = ${id}`;
    if (!raw) return null;
    return { row: toRow(raw), report: unpackReport(raw.report) };
  }

  async findByCommit(repo: string, commit: string) {
    const [raw] = await this.sql<Array<RawRow & { report: Buffer }>>`
      SELECT id, repo, branch, commit_sha, pr, lines_covered, lines_total, files, created_at, report
      FROM uploads WHERE repo = ${repo} AND commit_sha = ${commit}
      ORDER BY id DESC LIMIT 1`;
    if (!raw) return null;
    return { row: toRow(raw), report: unpackReport(raw.report) };
  }

  async updateReport(id: number, patch: UpdateReportInput): Promise<UploadRow> {
    const [raw] = await this.sql<RawRow[]>`
      UPDATE uploads SET report = ${Buffer.from(packReport(patch.report))},
        lines_covered = ${patch.linesCovered}, lines_total = ${patch.linesTotal},
        files = ${patch.files}
      WHERE id = ${id}
      RETURNING id, repo, branch, commit_sha, pr, lines_covered, lines_total, files, created_at`;
    return toRow(raw!);
  }

  async latest(repo: string, branch?: string): Promise<UploadRow | null> {
    const rows = branch
      ? await this.sql<RawRow[]>`
          SELECT id, repo, branch, commit_sha, pr, lines_covered, lines_total, files, created_at
          FROM uploads WHERE repo = ${repo} AND branch = ${branch} ORDER BY id DESC LIMIT 1`
      : await this.sql<RawRow[]>`
          SELECT id, repo, branch, commit_sha, pr, lines_covered, lines_total, files, created_at
          FROM uploads WHERE repo = ${repo} ORDER BY id DESC LIMIT 1`;
    return rows[0] ? toRow(rows[0]) : null;
  }

  async listPRs(repo: string, limit: number): Promise<PROverview[]> {
    const groups = await this.sql<Array<{ pr: number; latest_id: string; uploads: string }>>`
      SELECT pr, MAX(id) AS latest_id, COUNT(*) AS uploads FROM uploads
      WHERE repo = ${repo} AND pr IS NOT NULL GROUP BY pr ORDER BY latest_id DESC LIMIT ${limit}`;
    const out: PROverview[] = [];
    for (const g of groups) {
      const [raw] = await this.sql<RawRow[]>`
        SELECT id, repo, branch, commit_sha, pr, lines_covered, lines_total, files, created_at
        FROM uploads WHERE id = ${g.latest_id}`;
      out.push({ pr: g.pr, latest: toRow(raw!), uploads: Number(g.uploads) });
    }
    return out;
  }

  async getRepoToken(repo: string): Promise<string | null> {
    const rows = await this.sql<Array<{ token: string }>>`
      SELECT token FROM repo_tokens WHERE repo = ${repo}`;
    return rows[0]?.token ?? null;
  }

  async setRepoToken(repo: string, token: string): Promise<void> {
    await this.sql`
      INSERT INTO repo_tokens (repo, token) VALUES (${repo}, ${token})
      ON CONFLICT (repo) DO UPDATE SET token = EXCLUDED.token`;
  }

  async getSubscription(account: string): Promise<Subscription | null> {
    const rows = await this.sql<
      Array<{
        account: string;
        plan: string;
        status: string;
        stripe_customer: string | null;
        current_period_end: string | null;
      }>
    >`SELECT account, plan, status, stripe_customer, current_period_end FROM subscriptions WHERE account = ${account}`;
    const r = rows[0];
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
    await this.sql`
      INSERT INTO subscriptions (account, plan, status, stripe_customer, current_period_end)
      VALUES (${sub.account}, ${sub.plan}, ${sub.status}, ${sub.stripeCustomer}, ${sub.currentPeriodEnd})
      ON CONFLICT (account) DO UPDATE SET plan = EXCLUDED.plan, status = EXCLUDED.status,
        stripe_customer = EXCLUDED.stripe_customer, current_period_end = EXCLUDED.current_period_end`;
  }

  async findSubscriptionByCustomer(stripeCustomer: string): Promise<Subscription | null> {
    const rows = await this.sql<
      Array<{
        account: string;
        plan: string;
        status: string;
        stripe_customer: string | null;
        current_period_end: string | null;
      }>
    >`SELECT account, plan, status, stripe_customer, current_period_end FROM subscriptions WHERE stripe_customer = ${stripeCustomer}`;
    const r = rows[0];
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
    const rows = await this.sql<Array<{ value: string }>>`
      SELECT value FROM meta WHERE key = ${key}`;
    return rows[0]?.value ?? null;
  }

  async setMeta(key: string, value: string): Promise<void> {
    await this.sql`
      INSERT INTO meta (key, value) VALUES (${key}, ${value})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
  }

  async createTestRun(input: CreateTestRunInput): Promise<TestRunRow> {
    const [row] = await this.sql<RawTestRun[]>`
      INSERT INTO test_runs (repo, branch, commit_sha, pr, framework, tests_passed, tests_failed, tests_skipped, duration_ms)
      VALUES (${input.repo}, ${input.branch}, ${input.commit}, ${input.pr}, ${input.framework},
        ${input.testsPassed}, ${input.testsFailed}, ${input.testsSkipped}, ${input.durationMs})
      RETURNING *`;
    return toTestRun(row!);
  }

  async createTestArtifact(input: CreateTestArtifactInput): Promise<TestArtifactRow> {
    const [row] = await this.sql<RawArtifact[]>`
      INSERT INTO test_artifacts (run_id, name, kind, content_type, size_bytes, object_key, test_name)
      VALUES (${input.runId}, ${input.name}, ${input.kind}, ${input.contentType}, ${input.sizeBytes},
        ${input.objectKey}, ${input.testName}) RETURNING *`;
    return toArtifact(row!);
  }

  async completeTestRun(id: number): Promise<TestRunRow | null> {
    const [row] = await this.sql<RawTestRun[]>`
      UPDATE test_runs SET status = 'complete', completed_at = now() WHERE id = ${id} RETURNING *`;
    return row ? toTestRun(row) : null;
  }

  async failTestRun(id: number): Promise<void> {
    await this.sql`UPDATE test_runs SET status = 'failed', completed_at = now() WHERE id = ${id}`;
  }

  async getTestRun(id: number) {
    const [raw] = await this.sql<RawTestRun[]>`SELECT * FROM test_runs WHERE id = ${id}`;
    if (!raw) return null;
    const artifacts = await this.sql<
      RawArtifact[]
    >`SELECT * FROM test_artifacts WHERE run_id = ${id} ORDER BY id`;
    return { run: toTestRun(raw), artifacts: artifacts.map(toArtifact) };
  }

  async listTestRuns(repo: string, limit: number): Promise<TestRunRow[]> {
    const rows = await this.sql<
      RawTestRun[]
    >`SELECT * FROM test_runs WHERE repo = ${repo} ORDER BY id DESC LIMIT ${limit}`;
    return rows.map(toTestRun);
  }

  async deleteTestRun(id: number): Promise<void> {
    await this.sql`DELETE FROM test_runs WHERE id = ${id}`;
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 2 });
  }
}
