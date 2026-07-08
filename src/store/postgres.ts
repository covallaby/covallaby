import postgres from "postgres";
import {
  type RecordUploadInput,
  type RepoOverview,
  type Store,
  type UploadRow,
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_uploads_repo_branch_time
  ON uploads(repo, branch, created_at DESC);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
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

export class PostgresStore implements Store {
  private constructor(private readonly sql: postgres.Sql) {}

  static async connect(url: string): Promise<PostgresStore> {
    const sql = postgres(url, { max: 5, onnotice: () => {} });
    await sql.unsafe(SCHEMA);
    return new PostgresStore(sql);
  }

  async recordUpload(input: RecordUploadInput): Promise<UploadRow> {
    const [raw] = await this.sql<RawRow[]>`
      INSERT INTO uploads (repo, branch, commit_sha, pr, lines_covered, lines_total, files, report)
      VALUES (${input.repo}, ${input.branch}, ${input.commit}, ${input.pr},
              ${input.linesCovered}, ${input.linesTotal}, ${input.files},
              ${Buffer.from(packReport(input.report))})
      RETURNING id, repo, branch, commit_sha, pr, lines_covered, lines_total, files, created_at`;
    return toRow(raw!);
  }

  async listRepos(trendPoints: number): Promise<RepoOverview[]> {
    const latest = await this.sql<RawRow[]>`
      SELECT id, repo, branch, commit_sha, pr, lines_covered, lines_total, files, created_at
      FROM uploads WHERE id IN (SELECT MAX(id) FROM uploads GROUP BY repo)
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

  async recentUploads(limit: number): Promise<UploadRow[]> {
    const rows = await this.sql<RawRow[]>`
      SELECT id, repo, branch, commit_sha, pr, lines_covered, lines_total, files, created_at
      FROM uploads ORDER BY id DESC LIMIT ${limit}`;
    return rows.map(toRow);
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

  async close(): Promise<void> {
    await this.sql.end({ timeout: 2 });
  }
}
