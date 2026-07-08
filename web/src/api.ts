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
    /** Per-executable-line state, one char/line: "2" covered, "1" partial, "0" missed. */
    cov: string;
  }>;
}

/** Portfolio coverage debt over time — covered vs. total across every repo. */
export interface PortfolioTrends {
  series: Array<{ t: number; covered: number; total: number; percent: number | null }>;
}

/** Covered lines by top-level directory across a branch's recent uploads. */
export interface DirTrends {
  repo: string;
  branch: string;
  steps: Array<{ t: number; commit: string }>;
  dirs: Array<{ dir: string; values: number[] }>;
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

const liveApi = {
  repos: () => get<{ repos: RepoOverview[] }>("/api/v1/repos"),
  activity: () => get<{ uploads: UploadRow[] }>("/api/v1/activity"),
  history: (repo: string, branch?: string) =>
    get<RepoHistory>(
      `/api/v1/repos/${repo}/history${branch ? `?branch=${encodeURIComponent(branch)}` : ""}`,
    ),
  upload: (id: string) => get<UploadDetail>(`/api/v1/uploads/${id}`),
  trends: () => get<PortfolioTrends>("/api/v1/trends"),
  dirTrends: (repo: string, branch?: string) =>
    get<DirTrends>(
      `/api/v1/repos/${repo}/dir-trends${branch ? `?branch=${encodeURIComponent(branch)}` : ""}`,
    ),
  prs: (repo: string) => get<{ prs: PROverview[] }>(`/api/v1/repos/${repo}/prs`),
  compare: (repo: string, q: { pr?: number; head?: string; base?: string }) => {
    const params = new URLSearchParams();
    if (q.pr !== undefined) params.set("pr", String(q.pr));
    if (q.head) params.set("head", q.head);
    if (q.base) params.set("base", q.base);
    return get<CompareResult>(`/api/v1/repos/${repo}/compare?${params}`);
  },
};

/** In the static demo build the same UI runs on captured fixtures. */
export const IS_DEMO = import.meta.env.VITE_DEMO === "1";

// Lazy so the ~900KB fixture bundle never loads in the real server build.
let demo: typeof liveApi | null = null;
export const api: typeof liveApi = IS_DEMO
  ? {
      repos: (...a) => load().then((d) => d.repos(...a)),
      activity: (...a) => load().then((d) => d.activity(...a)),
      history: (...a) => load().then((d) => d.history(...a)),
      upload: (...a) => load().then((d) => d.upload(...a)),
      trends: (...a) => load().then((d) => d.trends(...a)),
      dirTrends: (...a) => load().then((d) => d.dirTrends(...a)),
      prs: (...a) => load().then((d) => d.prs(...a)),
      compare: (...a) => load().then((d) => d.compare(...a)),
    }
  : liveApi;

async function load(): Promise<typeof liveApi> {
  if (!demo) demo = (await import("./demo/mockApi.js")).demoApi as unknown as typeof liveApi;
  return demo;
}

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
