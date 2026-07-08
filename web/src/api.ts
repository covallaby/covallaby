export interface UploadRow {
  id: number;
  repo: string;
  branch: string;
  commit: string;
  pr: number | null;
  linesCovered: number;
  linesTotal: number;
  percent: number | null;
  files: number;
  createdAt: string;
}

export interface RepoOverview {
  repo: string;
  latest: UploadRow;
  trend: Array<number | null>;
}

export interface Counter {
  covered: number;
  total: number;
  percent: number | null;
}

export interface PROverview {
  pr: number;
  latest: UploadRow;
  uploads: number;
}

export interface ReportChanges {
  added: Array<{ path: string; percent: number | null; total: number }>;
  removed: number;
  changed: Array<{ path: string; before: number | null; after: number | null; delta: number }>;
}

export interface CompareResult {
  head: UploadRow;
  base: UploadRow;
  same: boolean;
  changes: ReportChanges | null;
}

export interface UploadChanges {
  prevCommit: string;
  prevPercent: number | null;
  added: Array<{ path: string; percent: number | null; total: number }>;
  removed: number;
  changed: Array<{ path: string; before: number | null; after: number | null; delta: number }>;
}

export interface UploadDetail {
  changes: UploadChanges | null;
  row: UploadRow;
  totals: { lines: Counter; functions: Counter; branches: Counter; files: number };
  directories: Array<{ path: string; covered: number; total: number; percent: number | null }>;
  files: Array<{
    path: string;
    covered: number;
    total: number;
    percent: number | null;
    missing: string;
  }>;
}

export interface RepoHistory {
  repo: string;
  branch: string;
  branches: string[];
  history: UploadRow[];
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

export const api = {
  repos: () => get<{ repos: RepoOverview[] }>("/api/v1/repos"),
  activity: () => get<{ uploads: UploadRow[] }>("/api/v1/activity"),
  history: (repo: string, branch?: string) =>
    get<RepoHistory>(
      `/api/v1/repos/${repo}/history${branch ? `?branch=${encodeURIComponent(branch)}` : ""}`,
    ),
  upload: (id: string) => get<UploadDetail>(`/api/v1/uploads/${id}`),
  prs: (repo: string) => get<{ prs: PROverview[] }>(`/api/v1/repos/${repo}/prs`),
  compare: (repo: string, q: { pr?: number; head?: string; base?: string }) => {
    const params = new URLSearchParams();
    if (q.pr !== undefined) params.set("pr", String(q.pr));
    if (q.head) params.set("head", q.head);
    if (q.base) params.set("base", q.base);
    return get<CompareResult>(`/api/v1/repos/${repo}/compare?${params}`);
  },
};

export function formatPercent(value: number | null): string {
  if (value === null) return "—";
  return `${(Math.floor(value * 10 + 1e-9) / 10).toFixed(1)}%`;
}

export type Severity = "good" | "ok" | "warn" | "bad" | "muted";

export function severity(percent: number | null): Severity {
  if (percent === null) return "muted";
  if (percent >= 90) return "good";
  if (percent >= 75) return "ok";
  if (percent >= 60) return "warn";
  return "bad";
}
