import type {
  ActivityFeed,
  ActivityItem,
  CompareResult,
  DirTrends,
  PolicyStatus,
  PolicyVerdict,
  PolicyViolation,
  PortfolioTrends,
  RepoActivityFeed,
  RepoHistory,
  RepoOverview,
  RepoPolicy,
  StorybookPreview,
  TestRun,
  UploadDetail,
  UploadRow,
} from "../api.js";
import fixtures from "./fixtures.json";

/**
 * The playable demo: the real dashboard wired to captured API responses, so
 * covallaby.github.io/demo runs entirely client-side with no server. Data is
 * a snapshot of a real seeded instance — everything is navigable.
 */
interface Fixtures {
  repos: { repos: RepoOverview[] };
  activity: { uploads: UploadRow[] };
  history: Record<string, RepoHistory>;
  prs: Record<string, { prs: Array<{ pr: number; latest: UploadRow; uploads: number }> }>;
  uploads: Record<string, UploadDetail>;
  compares: Record<string, CompareResult>;
}

const F = fixtures as unknown as Fixtures;

const settle = <T>(value: T): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), 120)); // a beat, so skeletons show

function notFound(what: string): never {
  throw new Error(`404 ${what} (not in the demo snapshot)`);
}

const DAY = 86_400_000;

/** The fixtures predate per-line data; synthesize a stable barcode from path + coverage. */
function synthCov(f: { path: string; total: number; percent: number | null }): string {
  const total = f.total || 0;
  if (total === 0) return "";
  const missed = Math.min(total, Math.round(total * (1 - (f.percent ?? 100) / 100)));
  let seed = 0;
  for (const ch of f.path) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const arr = new Array<string>(total).fill("2");
  let placed = 0;
  for (let guard = 0; placed < missed && guard < total * 4; guard++) {
    const runLen = Math.min(missed - placed, 1 + Math.floor(rnd() * 4));
    const start = Math.floor(rnd() * Math.max(1, total - runLen));
    for (let i = start; i < start + runLen && i < total; i++) {
      if (arr[i] === "2") {
        arr[i] = "0";
        placed++;
      }
    }
  }
  return arr.join("");
}

function withCov(detail: UploadDetail): UploadDetail {
  return { ...detail, files: detail.files.map((f) => ({ ...f, cov: f.cov || synthCov(f) })) };
}

/**
 * Derive prev/next lateral navigation from the history snapshot, limited to
 * neighbors that are actually navigable in the demo (their detail fixture
 * exists). The fixtures predate the neighbors field on the live API.
 */
function withNeighbors(detail: UploadDetail): UploadDetail {
  const lane = (F.history[detail.row.repo]?.history ?? []).filter(
    (u) => u.branch === detail.row.branch && (u.id === detail.row.id || F.uploads[String(u.id)]),
  );
  const at = lane.findIndex((u) => u.id === detail.row.id);
  if (at === -1) return detail;
  // History is newest-first, so "previous" is the next index down the list.
  return { ...detail, neighbors: { prev: lane[at + 1] ?? null, next: lane[at - 1] ?? null } };
}

function portfolioTrends(): PortfolioTrends {
  const perRepo = F.repos.repos.map((o) =>
    (F.history[o.repo]?.history ?? [])
      .map((u) => ({ t: Date.parse(u.createdAt), covered: u.linesCovered, total: u.linesTotal }))
      .filter((p) => Number.isFinite(p.t)),
  );
  const dayOf = (t: number) => Math.floor(t / DAY) * DAY;
  const days = [...new Set(perRepo.flat().map((p) => dayOf(p.t)))].sort((a, b) => a - b).slice(-24);
  const series = days.map((day) => {
    const end = day + DAY - 1;
    let covered = 0;
    let total = 0;
    for (const repo of perRepo) {
      let best: { t: number; covered: number; total: number } | null = null;
      for (const p of repo) if (p.t <= end && (!best || p.t > best.t)) best = p;
      if (best) {
        covered += best.covered;
        total += best.total;
      }
    }
    return { t: day, covered, total, percent: total === 0 ? null : (covered / total) * 100 };
  });
  return { series };
}

function dirTrends(repo: string, branch?: string): DirTrends {
  const key = branch ? `${repo}@${branch}` : repo;
  const hist = (F.history[key] ?? F.history[repo])?.history ?? [];
  const resolved = branch ?? F.history[repo]?.branch ?? "main";
  const seq = hist.slice(0, 12).reverse();
  const steps = seq.map((u) => ({ t: Date.parse(u.createdAt), commit: u.commit }));
  const byDir = new Map<string, number[]>();
  seq.forEach((u, i) => {
    for (const d of F.uploads[String(u.id)]?.directories ?? []) {
      const top = d.path.split("/")[0] || d.path;
      if (!byDir.has(top)) byDir.set(top, new Array(seq.length).fill(0));
      const arr = byDir.get(top)!;
      arr[i] = (arr[i] ?? 0) + d.covered;
    }
  });
  // Fallback so the demo always draws: split each upload's covered lines into
  // three plausible folders when the snapshot has no per-directory rollup.
  if (byDir.size === 0 && seq.length >= 2) {
    const ratios: Array<[string, number]> = [
      ["src", 0.55],
      ["lib", 0.3],
      ["tests", 0.15],
    ];
    for (const [dir, r] of ratios) {
      byDir.set(
        dir,
        seq.map((u) => Math.round(u.linesCovered * r)),
      );
    }
  }
  const dirs = [...byDir.entries()]
    .sort((a, b) => (b[1][b[1].length - 1] ?? 0) - (a[1][a[1].length - 1] ?? 0))
    .slice(0, 6)
    .map(([dir, values]) => ({ dir, values }));
  return { repo, branch: resolved, steps, dirs };
}

// Demo Playwright (journey) and Storybook (component) runs for the flagship
// repo, so the portfolio feed and the review pages exercise mixed-type rows.
const DEMO_RUNS: TestRun[] = [
  {
    id: 42,
    repo: "covallaby/covallaby",
    branch: "feature/checkout-polish",
    commit: "8f31cb8d59ea5bb8e8dcf7cd981bfc5fbdfa456a",
    pr: 128,
    framework: "playwright",
    status: "complete",
    testsPassed: 34,
    testsFailed: 0,
    testsSkipped: 2,
    durationMs: 48210,
    createdAt: "2026-07-11T18:42:00.000Z",
    completedAt: "2026-07-11T18:43:02.000Z",
  },
  {
    id: 41,
    repo: "covallaby/covallaby",
    branch: "main",
    commit: "72d41f0dd8e6abfe280d9e340c277421f3607184",
    pr: null,
    framework: "playwright",
    status: "complete",
    testsPassed: 31,
    testsFailed: 1,
    testsSkipped: 1,
    durationMs: 55900,
    createdAt: "2026-07-10T16:14:00.000Z",
    completedAt: "2026-07-10T16:15:12.000Z",
  },
];

const DEMO_PREVIEWS: StorybookPreview[] = [
  {
    id: 18,
    repo: "covallaby/covallaby",
    branch: "feature/checkout-polish",
    commit: "8f31cb8d59ea5bb8e8dcf7cd981bfc5fbdfa456a",
    pr: 128,
    framework: "storybook",
    status: "complete",
    testsPassed: 0,
    testsFailed: 0,
    testsSkipped: 0,
    durationMs: 0,
    createdAt: "2026-07-11T18:42:00.000Z",
    completedAt: "2026-07-11T18:43:02.000Z",
    reviewState: "pending",
    imageCount: 24,
  },
  {
    id: 17,
    repo: "covallaby/covallaby",
    branch: "main",
    commit: "72d41f0dd8e6abfe280d9e340c277421f3607184",
    pr: null,
    framework: "storybook",
    status: "complete",
    testsPassed: 0,
    testsFailed: 0,
    testsSkipped: 0,
    durationMs: 0,
    createdAt: "2026-07-10T16:14:00.000Z",
    completedAt: "2026-07-10T16:15:12.000Z",
    reviewState: "auto-accepted",
    imageCount: 19,
  },
];

/** The demo's unified three-signal feed: fixtures + demo runs, newest first. */
function activityFeed(): ActivityFeed {
  const items: ActivityItem[] = [
    ...F.activity.uploads.map((upload) => ({ type: "coverage" as const, ...upload })),
    ...DEMO_RUNS.map((run) => ({ type: "journeys" as const, ...run })),
    ...DEMO_PREVIEWS.map((preview) => ({ type: "components" as const, ...preview })),
  ].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id - a.id);
  return { uploads: F.activity.uploads, items, runsSupported: true };
}

/** The repo-scoped feed behind the Activity tab: history + demo runs, one repo. */
function repoActivityFeed(repo: string, branch?: string): RepoActivityFeed {
  // The repo's uploads across every history snapshot (repo and repo@branch
  // keys overlap), deduplicated by upload id.
  const byId = new Map<number, UploadRow>();
  for (const [key, snapshot] of Object.entries(F.history)) {
    if (key !== repo && !key.startsWith(`${repo}@`)) continue;
    for (const upload of snapshot.history) byId.set(upload.id, upload);
  }
  const uploads = [...byId.values()];
  const items: ActivityItem[] = [
    ...uploads.map((upload) => ({ type: "coverage" as const, ...upload })),
    ...DEMO_RUNS.filter((run) => run.repo === repo).map((run) => ({
      type: "journeys" as const,
      ...run,
    })),
    ...DEMO_PREVIEWS.filter((preview) => preview.repo === repo).map((preview) => ({
      type: "components" as const,
      ...preview,
    })),
  ]
    .filter((item) => !branch || item.branch === branch)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id - a.id);
  return { repo, branch: branch ?? null, items, runsSupported: true };
}

// Demo-only sample policies so the Policy page shows both a pass and a fail.
const DEMO_POLICIES: Record<string, RepoPolicy> = {
  "acme/megarepo": { minProject: 70, maxDrop: 1 },
  "covallaby/covallaby": { minProject: 90, maxDrop: 0.5 },
};
const pct1 = (n: number | null) => (n === null ? "—" : `${(Math.floor(n * 10) / 10).toFixed(1)}%`);

function policyStatus(repo: string): PolicyStatus {
  const policy = DEMO_POLICIES[repo] ?? null;
  const hist = F.history[repo]?.history ?? [];
  const head = hist[0] ?? null;
  const base = hist[1] ?? null;
  const violations: PolicyViolation[] = [];
  if (policy && head) {
    const p = head.percent;
    if (policy.minProject !== undefined && (p === null || p < policy.minProject)) {
      violations.push({
        kind: "project",
        actual: p,
        required: policy.minProject,
        message: `Project coverage is ${pct1(p)}, but ${pct1(policy.minProject)} is required.`,
      });
    }
    if (policy.maxDrop !== undefined && base?.percent != null && p != null) {
      const drop = base.percent - p;
      if (drop > policy.maxDrop) {
        violations.push({
          kind: "drop",
          actual: drop,
          required: policy.maxDrop,
          message: `Project coverage fell ${pct1(drop)}; at most ${pct1(policy.maxDrop)} is allowed.`,
        });
      }
    }
  }
  return {
    repo,
    configured: policy !== null,
    passed: violations.length === 0,
    violations,
    head,
    base,
    basis: base ? "previous" : "none",
  };
}

/** Mirror the server's verdict payload for the fixture data (same floor-to-0.1 grain). */
function demoVerdict(
  repo: string,
  head: { commit: string; percent: number | null },
  base: { commit: string; percent: number | null } | null,
  added: Array<{ path: string; percent: number | null }> | null,
): PolicyVerdict {
  const policy = DEMO_POLICIES[repo] ?? null;
  const floor1 = (n: number) => Math.floor(n * 10 + 1e-9) / 10;
  const violations: PolicyViolation[] = [];
  if (policy) {
    const p = head.percent;
    if (policy.minProject !== undefined && (p === null || floor1(p) < policy.minProject)) {
      violations.push({
        kind: "project",
        actual: p,
        required: policy.minProject,
        message: `Project coverage is ${pct1(p)}, but ${pct1(policy.minProject)} is required.`,
      });
    }
    if (policy.maxDrop !== undefined && base?.percent != null && p !== null) {
      const drop = base.percent - p;
      if (floor1(drop) > policy.maxDrop) {
        violations.push({
          kind: "drop",
          actual: drop,
          required: policy.maxDrop,
          message: `Project coverage fell ${pct1(drop)} (from ${pct1(base.percent)} to ${pct1(p)}); at most ${pct1(policy.maxDrop)} is allowed.`,
        });
      }
    }
  }
  const belowFloor =
    policy?.minNewFile !== undefined
      ? (added ?? []).filter((f) => f.percent !== null && floor1(f.percent) < policy.minNewFile!)
          .length
      : 0;
  return {
    configured: policy !== null,
    passed: policy === null || violations.length === 0,
    violations,
    rules: policy,
    head,
    base,
    newFiles: added ? { total: added.length, belowFloor } : null,
  };
}

export const demoApi = {
  repos: () => settle(F.repos),
  policy: (repo: string) => settle({ repo, policy: DEMO_POLICIES[repo] ?? null }),
  status: (repo: string) => settle(policyStatus(repo)),
  activity: () => settle(activityFeed()),
  repoActivity: (repo: string, branch?: string) => settle(repoActivityFeed(repo, branch)),
  testRuns: (repo: string) => settle({ runs: repo === "covallaby/covallaby" ? DEMO_RUNS : [] }),
  storybookPreviews: (repo: string) =>
    settle({ previews: repo === "covallaby/covallaby" ? DEMO_PREVIEWS : [] }),
  history: (repo: string, branch?: string) => {
    const key = branch ? `${repo}@${branch}` : repo;
    return settle(F.history[key] ?? F.history[repo] ?? notFound(`history for ${key}`));
  },
  upload: (id: string) => {
    const detail = F.uploads[id]
      ? withNeighbors(withCov(F.uploads[id]!))
      : notFound(`upload ${id}`);
    return settle({
      ...detail,
      verdict: demoVerdict(
        detail.row.repo,
        { commit: detail.row.commit, percent: detail.row.percent },
        detail.changes
          ? { commit: detail.changes.prevCommit, percent: detail.changes.prevPercent }
          : null,
        detail.changes?.added ?? null,
      ),
    });
  },
  trends: () => settle(portfolioTrends()),
  dirTrends: (repo: string, branch?: string) => settle(dirTrends(repo, branch)),
  prs: (repo: string) => settle(F.prs[repo] ?? { prs: [] }),
  compare: (repo: string, q: { pr?: number; head?: string; base?: string }) => {
    const base = q.base ?? "main";
    const result =
      q.pr !== undefined
        ? (F.compares[`pr:${repo}:${q.pr}:${base}`] ?? notFound(`compare pr ${q.pr}`))
        : (F.compares[`pr:${repo}:?:${base}`] ?? notFound("branch compare"));
    return settle({
      ...result,
      verdict: demoVerdict(
        repo,
        { commit: result.head.commit, percent: result.head.percent },
        result.same ? null : { commit: result.base.commit, percent: result.base.percent },
        result.changes?.added ?? null,
      ),
    });
  },
};
