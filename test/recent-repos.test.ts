import { describe, expect, it } from "vitest";
import {
  type RecentVisit,
  parseRecentVisits,
  recordRepoVisit,
  selectRecentRepos,
  withVisit,
} from "../web/src/recent-repos.js";

const visit = (repo: string, visitedAt: number): RecentVisit => ({ repo, visitedAt });

describe("parseRecentVisits", () => {
  it("returns [] for missing, garbled, or non-array storage", () => {
    expect(parseRecentVisits(null)).toEqual([]);
    expect(parseRecentVisits("not json{")).toEqual([]);
    expect(parseRecentVisits('{"repo":"a/b"}')).toEqual([]);
  });

  it("drops malformed entries but keeps valid ones", () => {
    const raw = JSON.stringify([
      visit("acme/web", 3),
      { repo: "no-slash", visitedAt: 2 },
      { repo: "acme/api" }, // missing timestamp
      null,
      visit("acme/api", 1),
    ]);
    expect(parseRecentVisits(raw)).toEqual([visit("acme/web", 3), visit("acme/api", 1)]);
  });
});

describe("withVisit", () => {
  it("prepends the new visit and dedupes an earlier one for the same repo", () => {
    const next = withVisit([visit("acme/web", 2), visit("acme/api", 1)], "acme/api", 5);
    expect(next).toEqual([visit("acme/api", 5), visit("acme/web", 2)]);
  });

  it("caps the stored list", () => {
    let visits: RecentVisit[] = [];
    for (let i = 0; i < 30; i++) visits = withVisit(visits, `acme/repo-${i}`, i);
    expect(visits.length).toBe(12);
    expect(visits[0]).toEqual(visit("acme/repo-29", 29));
  });
});

describe("selectRecentRepos", () => {
  const available = ["acme/a", "acme/b", "acme/c", "acme/d", "acme/e", "acme/f"];

  it("orders by most recent visit regardless of stored order", () => {
    const visits = [visit("acme/a", 1), visit("acme/c", 9), visit("acme/b", 5)];
    expect(selectRecentRepos({ visits })).toEqual(["acme/c", "acme/b", "acme/a"]);
  });

  it("caps the list at the limit", () => {
    const visits = available.map((repo, i) => visit(repo, i));
    expect(selectRecentRepos({ visits })).toHaveLength(5);
    expect(selectRecentRepos({ visits, limit: 3 })).toHaveLength(3);
  });

  it("always shows the current repo first, even when it was visited long ago", () => {
    const visits = [visit("acme/a", 9), visit("acme/b", 5), visit("acme/c", 1)];
    expect(selectRecentRepos({ visits, currentRepo: "acme/c" })).toEqual([
      "acme/c",
      "acme/a",
      "acme/b",
    ]);
  });

  it("shows the current repo even when it has never been visited or listed", () => {
    expect(selectRecentRepos({ visits: [], currentRepo: "other/new", available })).toEqual([
      "other/new",
      "acme/a",
      "acme/b",
      "acme/c",
      "acme/d",
    ]);
  });

  it("shows only what exists when fewer repos than the limit were visited", () => {
    const visits = [visit("acme/a", 2), visit("acme/b", 1)];
    expect(selectRecentRepos({ visits, available })).toEqual(["acme/a", "acme/b"]);
  });

  it("seeds from the API list when nothing was visited yet", () => {
    expect(selectRecentRepos({ visits: [], available })).toEqual(available.slice(0, 5));
    expect(selectRecentRepos({ visits: [], available: [] })).toEqual([]);
  });
});

describe("recordRepoVisit", () => {
  it("round-trips through a Storage-like store, newest first", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    };
    recordRepoVisit("acme/web", storage, 1);
    recordRepoVisit("acme/api", storage, 2);
    recordRepoVisit("acme/web", storage, 3);
    const raw = store.get("covallaby-recent-repos") ?? null;
    expect(parseRecentVisits(raw)).toEqual([visit("acme/web", 3), visit("acme/api", 2)]);
  });
});
