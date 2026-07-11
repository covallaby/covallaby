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

export interface TestRun {
  id: number;
  repo: string;
  branch: string;
  commit: string;
  pr: number | null;
  framework: string;
  status: "uploading" | "complete" | "failed";
  testsPassed: number;
  testsFailed: number;
  testsSkipped: number;
  durationMs: number;
  createdAt: string;
  completedAt: string | null;
}

export interface TestArtifact {
  id: number;
  runId: number;
  name: string;
  kind: "video" | "screenshot" | "trace" | "report" | "results" | "other";
  contentType: string;
  sizeBytes: number;
  testName: string | null;
  createdAt: string;
  url: string;
}

export interface StorybookPreview extends TestRun {}

/** A repo's merge policy — the "can I merge?" gate. */
export interface RepoPolicy {
  minProject?: number;
  maxDrop?: number;
  minNewFile?: number;
}

export interface PolicyViolation {
  kind: "project" | "drop" | "new-file";
  actual: number | null;
  required: number;
  message: string;
}

export interface PolicyStatus {
  repo: string;
  configured: boolean;
  passed: boolean;
  violations: PolicyViolation[];
  head: UploadRow | null;
  base: UploadRow | null;
  basis: "compare" | "previous" | "none";
  note?: string;
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

/** Hosted-mode auth state. */
export interface Me {
  authenticated: boolean;
  login?: string;
  name?: string | null;
  accounts?: string[];
}

export interface GitHubAppStatus {
  configured: boolean;
  slug?: string;
  accounts: Array<{ account: string; installed: boolean }>;
}

/**
 * The signed-in user, or `null` when the server isn't in hosted mode (the
 * self-hosted server has no auth layer, so `/api/v1/me` 404s). Never throws.
 */
async function fetchMe(): Promise<Me | null> {
  try {
    const res = await fetch("/api/v1/me");
    if (res.status === 404) return null; // self-hosted: public dashboard, no gate
    if (!res.ok) return { authenticated: false };
    return (await res.json()) as Me;
  } catch {
    return null;
  }
}

const liveApi = {
  repos: () => get<{ repos: RepoOverview[] }>("/api/v1/repos"),
  activity: () => get<{ uploads: UploadRow[] }>("/api/v1/activity"),
  history: (repo: string, branch?: string) =>
    get<RepoHistory>(
      `/api/v1/repos/${repo}/history${branch ? `?branch=${encodeURIComponent(branch)}` : ""}`,
    ),
  upload: (id: string) => get<UploadDetail>(`/api/v1/uploads/${id}`),
  me: fetchMe,
  githubApp: () => get<GitHubAppStatus>("/api/v1/github/status"),
  trends: () => get<PortfolioTrends>("/api/v1/trends"),
  dirTrends: (repo: string, branch?: string) =>
    get<DirTrends>(
      `/api/v1/repos/${repo}/dir-trends${branch ? `?branch=${encodeURIComponent(branch)}` : ""}`,
    ),
  prs: (repo: string) => get<{ prs: PROverview[] }>(`/api/v1/repos/${repo}/prs`),
  policy: (repo: string) =>
    get<{ repo: string; policy: RepoPolicy | null }>(`/api/v1/repos/${repo}/policy`),
  status: (repo: string) => get<PolicyStatus>(`/api/v1/repos/${repo}/status`),
  testRuns: (repo: string) => get<{ runs: TestRun[] }>(`/api/v1/repos/${repo}/test-runs`),
  testRun: (id: string) =>
    get<{ run: TestRun; artifacts: TestArtifact[] }>(`/api/v1/test-runs/${id}`),
  storybookPreviews: (repo: string) =>
    get<{ previews: StorybookPreview[] }>(`/api/v1/repos/${repo}/storybook-previews`),
  storybookPreview: (id: string) =>
    get<{ run: StorybookPreview; previewUrl: string }>(`/api/v1/storybook-previews/${id}`),
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
      me: () => Promise.resolve<Me | null>(null), // the static demo is always "public"
      githubApp: () => Promise.resolve({ configured: false, accounts: [] }),
      trends: (...a) => load().then((d) => d.trends(...a)),
      dirTrends: (...a) => load().then((d) => d.dirTrends(...a)),
      prs: (...a) => load().then((d) => d.prs(...a)),
      policy: (...a) => load().then((d) => d.policy(...a)),
      status: (...a) => load().then((d) => d.status(...a)),
      testRuns: () => Promise.resolve({ runs: [] }),
      testRun: () => Promise.reject(new Error("Playbacks are not included in the static demo.")),
      storybookPreviews: () => Promise.resolve({ previews: [] }),
      storybookPreview: () =>
        Promise.reject(new Error("Storybook previews are not included in the static demo.")),
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

export interface OwnerGroup {
  owner: string;
  repos: RepoOverview[];
  linesCovered: number;
  linesTotal: number;
  percent: number | null;
}

/**
 * Repo name for display, minus the redundant owner prefix. Many orgs name every
 * repo `<org>-<thing>` (mostly-good-metrics-swift-sdk), so under the org header
 * the prefix just repeats and truncates the useful part — drop it
 * (mostly-good-metrics-swift-sdk → swift-sdk; covallaby/covallaby → covallaby).
 */
export function shortRepoName(repo: string): string {
  const [owner, name = repo] = repo.split("/");
  const prefix = `${(owner ?? "").toLowerCase()}-`;
  return name.toLowerCase().startsWith(prefix) && name.length > prefix.length
    ? name.slice(prefix.length)
    : name;
}

/** Group repos by their GitHub owner (org/user), each with a coverage roll-up, owners A→Z. */
export function groupReposByOwner(repos: RepoOverview[]): OwnerGroup[] {
  const groups = new Map<string, RepoOverview[]>();
  for (const r of repos) {
    const owner = r.repo.split("/")[0] ?? r.repo;
    const list = groups.get(owner);
    if (list) list.push(r);
    else groups.set(owner, [r]);
  }
  return [...groups.entries()]
    .map(([owner, rs]) => {
      const linesCovered = rs.reduce((n, r) => n + r.latest.linesCovered, 0);
      const linesTotal = rs.reduce((n, r) => n + r.latest.linesTotal, 0);
      return {
        owner,
        repos: rs,
        linesCovered,
        linesTotal,
        percent: linesTotal === 0 ? null : (linesCovered / linesTotal) * 100,
      };
    })
    .sort((a, b) => a.owner.localeCompare(b.owner));
}

export type Severity = "good" | "ok" | "warn" | "bad" | "muted";

export function severity(percent: number | null): Severity {
  if (percent === null) return "muted";
  if (percent >= 90) return "good";
  if (percent >= 75) return "ok";
  if (percent >= 60) return "warn";
  return "bad";
}
