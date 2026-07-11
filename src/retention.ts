import type { ArtifactStorage } from "./artifacts.js";
import type { Store, TestRunRow } from "./store.js";

export interface ArtifactRetentionConfig {
  days: number;
  keepLatestDefaultBranch: boolean;
  /** Protect an unknown PR until GitHub tells hosted Covallaby that it closed. */
  keepLatestUnknownPR: boolean;
}

interface PRState {
  open: boolean;
  closedAt: string | null;
}

export const repoRetentionKey = (repo: string): string => `artifact-retention:repo:${repo}`;
export const prRetentionKey = (repo: string, pr: number): string =>
  `artifact-retention:pr:${repo}:${pr}`;

export function loadArtifactRetention(
  env: NodeJS.ProcessEnv = process.env,
): ArtifactRetentionConfig {
  const rawDays = Number(env.COVALLABY_ARTIFACT_RETENTION_DAYS ?? 30);
  return {
    days: Number.isFinite(rawDays) && rawDays >= 1 ? Math.floor(rawDays) : 30,
    keepLatestDefaultBranch: !/^(0|false)$/i.test(
      env.COVALLABY_KEEP_LATEST_DEFAULT_BRANCH ?? "true",
    ),
    keepLatestUnknownPR: !/^(0|false)$/i.test(env.COVALLABY_KEEP_LATEST_UNKNOWN_PRS ?? "true"),
  };
}

function parse<T>(raw: string | null): T | null {
  try {
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function recordRepoRetentionState(
  store: Store,
  repo: string,
  defaultBranch: string,
): Promise<void> {
  await store.setMeta(
    repoRetentionKey(repo),
    JSON.stringify({ defaultBranch, updatedAt: new Date().toISOString() }),
  );
}

export async function recordPRRetentionState(
  store: Store,
  repo: string,
  pr: number,
  open: boolean,
  closedAt: string | null,
): Promise<void> {
  await store.setMeta(
    prRetentionKey(repo, pr),
    JSON.stringify({ open, closedAt, updatedAt: new Date().toISOString() }),
  );
}

export async function cleanupRepoArtifacts(
  store: Store,
  storage: ArtifactStorage,
  repo: string,
  config: ArtifactRetentionConfig,
  now = new Date(),
): Promise<number> {
  if (!store.listTestRuns || !store.getTestRun || !store.deleteTestRun) return 0;
  const runs = await store.listTestRuns(repo, 10_000);
  const repoState = parse<{ defaultBranch?: string }>(await store.getMeta(repoRetentionKey(repo)));
  const defaultBranch =
    repoState?.defaultBranch ??
    (runs.some((r) => r.branch === "main")
      ? "main"
      : runs.some((r) => r.branch === "master")
        ? "master"
        : (runs.find((r) => r.pr === null)?.branch ?? "main"));
  const latestDefault = new Set<number>();
  const defaultFrameworks = new Set<string>();
  for (const run of runs) {
    if (
      run.status === "complete" &&
      run.branch === defaultBranch &&
      !defaultFrameworks.has(run.framework)
    ) {
      defaultFrameworks.add(run.framework);
      latestDefault.add(run.id);
    }
  }
  const latestByPR = new Map<string, TestRunRow>();
  for (const run of runs) {
    const key = `${run.pr}:${run.framework}`;
    if (run.pr !== null && run.status === "complete" && !latestByPR.has(key)) {
      latestByPR.set(key, run);
    }
  }

  const retentionMs = config.days * 86_400_000;
  const cutoff = now.getTime() - retentionMs;
  let deleted = 0;
  for (const run of runs) {
    if (Date.parse(run.createdAt) >= cutoff) continue;
    if (config.keepLatestDefaultBranch && latestDefault.has(run.id)) continue;
    if (run.pr !== null && latestByPR.get(`${run.pr}:${run.framework}`)?.id === run.id) {
      const state = parse<PRState>(await store.getMeta(prRetentionKey(repo, run.pr)));
      if (state?.open || (!state && config.keepLatestUnknownPR)) continue;
      if (state?.closedAt && Date.parse(state.closedAt) + retentionMs >= now.getTime()) continue;
    }
    const found = await store.getTestRun(run.id);
    if (!found) continue;
    await Promise.all(found.artifacts.map((a) => storage.delete(a.objectKey)));
    await store.deleteTestRun(run.id);
    deleted++;
  }
  return deleted;
}
