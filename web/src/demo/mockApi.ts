import type { CompareResult, RepoHistory, RepoOverview, UploadDetail, UploadRow } from "../api.js";
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

export const demoApi = {
  repos: () => settle(F.repos),
  activity: () => settle(F.activity),
  history: (repo: string, branch?: string) => {
    const key = branch ? `${repo}@${branch}` : repo;
    return settle(F.history[key] ?? F.history[repo] ?? notFound(`history for ${key}`));
  },
  upload: (id: string) => settle(F.uploads[id] ?? notFound(`upload ${id}`)),
  prs: (repo: string) => settle(F.prs[repo] ?? { prs: [] }),
  compare: (repo: string, q: { pr?: number; head?: string; base?: string }) => {
    const base = q.base ?? "main";
    if (q.pr !== undefined) {
      return settle(F.compares[`pr:${repo}:${q.pr}:${base}`] ?? notFound(`compare pr ${q.pr}`));
    }
    return settle(F.compares[`pr:${repo}:?:${base}`] ?? notFound("branch compare"));
  },
};
