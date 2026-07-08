import type {
  CompareResult,
  DirTrends,
  PolicyStatus,
  PolicyViolation,
  PortfolioTrends,
  RepoHistory,
  RepoOverview,
  RepoPolicy,
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

export const demoApi = {
  repos: () => settle(F.repos),
  policy: (repo: string) => settle({ repo, policy: DEMO_POLICIES[repo] ?? null }),
  status: (repo: string) => settle(policyStatus(repo)),
  activity: () => settle(F.activity),
  history: (repo: string, branch?: string) => {
    const key = branch ? `${repo}@${branch}` : repo;
    return settle(F.history[key] ?? F.history[repo] ?? notFound(`history for ${key}`));
  },
  upload: (id: string) =>
    settle(F.uploads[id] ? withCov(F.uploads[id]!) : notFound(`upload ${id}`)),
  trends: () => settle(portfolioTrends()),
  dirTrends: (repo: string, branch?: string) => settle(dirTrends(repo, branch)),
  prs: (repo: string) => settle(F.prs[repo] ?? { prs: [] }),
  compare: (repo: string, q: { pr?: number; head?: string; base?: string }) => {
    const base = q.base ?? "main";
    if (q.pr !== undefined) {
      return settle(F.compares[`pr:${repo}:${q.pr}:${base}`] ?? notFound(`compare pr ${q.pr}`));
    }
    return settle(F.compares[`pr:${repo}:?:${base}`] ?? notFound("branch compare"));
  },
};
