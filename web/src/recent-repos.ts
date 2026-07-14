/**
 * Recently visited repos for the sidebar rail (COV-26). Visits are stamped in
 * localStorage as `{ repo, visitedAt }` pairs, newest first, and the rail shows
 * the current repo followed by the most recent others.
 */

export const RECENT_REPOS_KEY = "covallaby-recent-repos";

/** How many repos the rail shows. */
export const RECENT_REPOS_LIMIT = 5;

/** Keep a few more than we show so older visits survive short detours. */
const STORED_LIMIT = 12;

export interface RecentVisit {
  /** Full repo name, `owner/name`. */
  repo: string;
  /** Epoch milliseconds of the last visit. */
  visitedAt: number;
}

/** Parse a stored visit list, tolerating missing or garbled storage. */
export function parseRecentVisits(raw: string | null): RecentVisit[] {
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter(
      (v): v is RecentVisit =>
        typeof v === "object" &&
        v !== null &&
        typeof (v as RecentVisit).repo === "string" &&
        (v as RecentVisit).repo.includes("/") &&
        typeof (v as RecentVisit).visitedAt === "number",
    );
  } catch {
    return [];
  }
}

/** A new visit list with `repo` stamped at `now` — newest first, deduped, capped. */
export function withVisit(visits: RecentVisit[], repo: string, now: number): RecentVisit[] {
  return [{ repo, visitedAt: now }, ...visits.filter((v) => v.repo !== repo)].slice(
    0,
    STORED_LIMIT,
  );
}

/**
 * The repos to show in the rail: the current repo first, then the most recent
 * visits. With nothing visited yet, seed from the API's repo list instead.
 */
export function selectRecentRepos({
  visits,
  currentRepo = null,
  available = [],
  limit = RECENT_REPOS_LIMIT,
}: {
  visits: RecentVisit[];
  currentRepo?: string | null;
  available?: string[];
  limit?: number;
}): string[] {
  const picks: string[] = currentRepo ? [currentRepo] : [];
  const sorted = [...visits].sort((a, b) => b.visitedAt - a.visitedAt);
  for (const visit of sorted) {
    if (picks.length >= limit) break;
    if (!picks.includes(visit.repo)) picks.push(visit.repo);
  }
  if (visits.length === 0) {
    for (const repo of available) {
      if (picks.length >= limit) break;
      if (!picks.includes(repo)) picks.push(repo);
    }
  }
  return picks;
}

/** The stored visit list — browser-side convenience over `parseRecentVisits`. */
export function readRecentVisits(storage: Pick<Storage, "getItem"> = localStorage): RecentVisit[] {
  return parseRecentVisits(storage.getItem(RECENT_REPOS_KEY));
}

/** Stamp a repo visit into storage (called on repo-route navigation). */
export function recordRepoVisit(
  repo: string,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
  now: number = Date.now(),
): void {
  const next = withVisit(parseRecentVisits(storage.getItem(RECENT_REPOS_KEY)), repo, now);
  storage.setItem(RECENT_REPOS_KEY, JSON.stringify(next));
}
