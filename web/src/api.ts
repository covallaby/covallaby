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
  /** CI-supplied base commit for baseline resolution, when provided. */
  baseSha?: string | null;
  createdAt: string;
}

/** Why a baseline was (or wasn't) chosen for a comparison or capture review. */
export interface BaselineInfo {
  reason:
    | "base-sha"
    | "previous-on-branch"
    | "latest-on-base"
    | "newer-on-base"
    | "first-on-branch"
    | "base-branch-empty";
  /** Friendly one-liner, e.g. `Baseline: abc1234 (latest on main)`. */
  message: string;
  baseBranch: string;
  commit: string | null;
}

/** Review verdict on a visual capture run; mainline builds are auto-accepted. */
export type ReviewState = "pending" | "approved" | "rejected" | "auto-accepted";

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
  baseline?: BaselineInfo;
  verdict?: PolicyVerdict;
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
  baseline?: BaselineInfo;
  verdict?: PolicyVerdict;
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
  baseSha?: string | null;
  reviewState?: ReviewState;
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
  viewerUrl?: string;
}

export interface StorybookPreview extends TestRun {
  artifactCount?: number;
  imageCount?: number;
}

export interface StorybookCapture {
  artifactId: number | null;
  id: string;
  title: string;
  name: string;
  imageUrl: string;
  baselineImageUrl?: string;
  diffImageUrl?: string;
  status: "changed" | "new" | "removed" | "unchanged" | "uncompared";
  /** Content hash of this run's capture, when the uploader provided one. */
  sha256?: string;
  /** Content hash of the baseline capture, when the uploader provided one. */
  baselineSha256?: string;
}

export interface StorybookDiffSummary {
  changed: number;
  new: number;
  removed: number;
  unchanged: number;
  uncompared: number;
}

export interface ReviewSignals {
  repo: string;
  runs: TestRun[];
  previews: StorybookPreview[];
}

/** Everything reported for one commit SHA — the envelope its artifact pages share. */
export interface CommitSiblings {
  commit: string;
  upload: UploadRow | null;
  run: TestRun | null;
  preview: StorybookPreview | null;
}

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

/**
 * The merge-gate verdict for one upload or comparison, plus the numbers that
 * produced it — mirrors the server's PolicyVerdict payload.
 */
export interface PolicyVerdict {
  configured: boolean;
  passed: boolean;
  violations: PolicyViolation[];
  /** The rules the verdict was judged against — null when no policy is set. */
  rules: RepoPolicy | null;
  head: { commit: string; percent: number | null };
  /** The baseline side, or null when there was nothing to compare against. */
  base: { commit: string; percent: number | null } | null;
  /** Files added vs the base, and how many sit under the new-file floor. */
  newFiles: { total: number; belowFloor: number } | null;
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
    get<{
      run: StorybookPreview;
      previewUrl: string;
      baselineRun: StorybookPreview | null;
      baseline?: BaselineInfo;
      summary: StorybookDiffSummary;
      captures: StorybookCapture[];
    }>(`/api/v1/storybook-previews/${id}`),
  reviewSignals: (repo?: string) =>
    get<{ repositories: ReviewSignals[] }>(
      `/api/v1/review-signals${repo ? `?repo=${encodeURIComponent(repo)}` : ""}`,
    ),
  commitSiblings: (repo: string, sha: string) =>
    get<CommitSiblings>(`/api/v1/repos/${repo}/commits/${encodeURIComponent(sha)}`),
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
      testRuns: (repo: string) =>
        Promise.resolve({
          ...(repo !== "covallaby/covallaby"
            ? { runs: [] }
            : {
                runs: [
                  {
                    id: 42,
                    repo,
                    branch: "feature/checkout-polish",
                    commit: "8f31cb8d59ea5bb8e8dcf7cd981bfc5fbdfa456a",
                    pr: 128,
                    framework: "playwright",
                    status: "complete" as const,
                    testsPassed: 34,
                    testsFailed: 0,
                    testsSkipped: 2,
                    durationMs: 48210,
                    createdAt: "2026-07-11T18:42:00.000Z",
                    completedAt: "2026-07-11T18:43:02.000Z",
                  },
                  {
                    id: 41,
                    repo,
                    branch: "main",
                    commit: "72d41f0dd8e6abfe280d9e340c277421f3607184",
                    pr: null,
                    framework: "playwright",
                    status: "complete" as const,
                    testsPassed: 31,
                    testsFailed: 1,
                    testsSkipped: 1,
                    durationMs: 55900,
                    createdAt: "2026-07-10T16:14:00.000Z",
                    completedAt: "2026-07-10T16:15:12.000Z",
                  },
                ],
              }),
        }),
      testRun: () => Promise.reject(new Error("Playbacks are not included in the static demo.")),
      storybookPreviews: (repo: string) =>
        Promise.resolve({
          ...(repo !== "covallaby/covallaby"
            ? { previews: [] }
            : {
                previews: [
                  {
                    id: 18,
                    repo,
                    branch: "feature/checkout-polish",
                    commit: "8f31cb8d59ea5bb8e8dcf7cd981bfc5fbdfa456a",
                    pr: 128,
                    framework: "storybook",
                    status: "complete" as const,
                    testsPassed: 0,
                    testsFailed: 0,
                    testsSkipped: 0,
                    durationMs: 0,
                    createdAt: "2026-07-11T18:42:00.000Z",
                    completedAt: "2026-07-11T18:43:02.000Z",
                    artifactCount: 28,
                    imageCount: 24,
                  },
                  {
                    id: 17,
                    repo,
                    branch: "main",
                    commit: "72d41f0dd8e6abfe280d9e340c277421f3607184",
                    pr: null,
                    framework: "storybook",
                    status: "complete" as const,
                    testsPassed: 0,
                    testsFailed: 0,
                    testsSkipped: 0,
                    durationMs: 0,
                    createdAt: "2026-07-10T16:14:00.000Z",
                    completedAt: "2026-07-10T16:15:12.000Z",
                    artifactCount: 22,
                    imageCount: 19,
                  },
                ],
              }),
        }),
      storybookPreview: (id: string) =>
        Promise.resolve({
          run: {
            id: Number(id),
            repo: "covallaby/covallaby",
            branch: "feature/checkout-polish",
            commit: "8f31cb8d59ea5bb8e8dcf7cd981bfc5fbdfa456a",
            pr: 128,
            framework: "storybook",
            status: "complete" as const,
            testsPassed: 0,
            testsFailed: 0,
            testsSkipped: 0,
            durationMs: 0,
            createdAt: "2026-07-11T18:42:00.000Z",
            completedAt: "2026-07-11T18:43:02.000Z",
            artifactCount: 3,
            imageCount: 2,
          },
          previewUrl: "https://example.invalid/storybook",
          baselineRun: {
            id: 17,
            repo: "covallaby/covallaby",
            branch: "main",
            commit: "72d41f0dd8",
            pr: null,
            framework: "storybook",
            status: "complete" as const,
            testsPassed: 0,
            testsFailed: 0,
            testsSkipped: 0,
            durationMs: 0,
            createdAt: "2026-07-10T16:14:00.000Z",
            completedAt: "2026-07-10T16:15:12.000Z",
          },
          summary: { changed: 1, new: 1, removed: 0, unchanged: 0, uncompared: 0 },
          captures: [
            {
              artifactId: 1,
              id: "dashboard--review-queue",
              title: "Dashboard/Review queue",
              name: "With component captures",
              status: "changed" as const,
              imageUrl:
                "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='450'%3E%3Crect width='100%25' height='100%25' fill='%231c1a17'/%3E%3Crect x='80' y='80' width='640' height='290' rx='18' fill='%2328231d' stroke='%23483f34'/%3E%3Ccircle cx='130' cy='135' r='18' fill='%2322c55e'/%3E%3Crect x='170' y='118' width='360' height='18' rx='9' fill='%23f5f1e8'/%3E%3Crect x='170' y='150' width='260' height='12' rx='6' fill='%238f8778'/%3E%3C/svg%3E",
              baselineImageUrl:
                "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='450'%3E%3Crect width='100%25' height='100%25' fill='%231c1a17'/%3E%3Crect x='100' y='95' width='600' height='260' rx='12' fill='%2328231d' stroke='%23483f34'/%3E%3Ccircle cx='145' cy='145' r='15' fill='%23d59b16'/%3E%3Crect x='180' y='130' width='300' height='16' rx='8' fill='%23f5f1e8'/%3E%3C/svg%3E",
              diffImageUrl:
                "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='450'%3E%3Crect width='100%25' height='100%25' fill='%231c1a17'/%3E%3Crect x='80' y='80' width='640' height='290' rx='18' fill='none' stroke='%23ff2f92' stroke-width='8'/%3E%3C/svg%3E",
            },
            {
              artifactId: 2,
              id: "playback--steps",
              title: "Visual testing/Playback",
              name: "Step gallery",
              status: "new" as const,
              imageUrl:
                "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='450'%3E%3Crect width='100%25' height='100%25' fill='%231c1a17'/%3E%3Crect x='60' y='60' width='205' height='330' rx='14' fill='%2328231d'/%3E%3Crect x='290' y='60' width='450' height='330' rx='14' fill='%23f5f1e8'/%3E%3C/svg%3E",
            },
          ],
        }),
      reviewSignals: async (repo?: string) => {
        const names = repo ? [repo] : ["acme/megarepo", "covallaby/covallaby", "covallaby/server"];
        return {
          repositories: await Promise.all(
            names.map(async (name) => ({
              repo: name,
              runs: (await api.testRuns(name)).runs,
              previews: (await api.storybookPreviews(name)).previews,
            })),
          ),
        };
      },
      commitSiblings: async (repo: string, sha: string) => {
        // Derived client-side in the demo: join the fixture surfaces on the SHA.
        const [runs, previews, history] = await Promise.all([
          api.testRuns(repo),
          api.storybookPreviews(repo),
          api.history(repo).catch(() => null),
        ]);
        return {
          commit: sha,
          upload: history?.history.find((u) => u.commit === sha) ?? null,
          run: runs.runs.find((r) => r.commit === sha) ?? null,
          preview: previews.previews.find((p) => p.commit === sha) ?? null,
        };
      },
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
