import { describe, expect, it } from "vitest";
import type { PROverview, UploadRow } from "../web/src/api.js";
import {
  branchItems,
  defaultBranchOf,
  filterScopeItems,
  keyActionFor,
  moveActive,
  prItems,
} from "../web/src/components/scope-picker.js";

function upload(over: Partial<UploadRow>): UploadRow {
  return {
    id: 1,
    repo: "acme/app",
    branch: "main",
    commit: "0123456789abcdef",
    pr: null,
    linesCovered: 80,
    linesTotal: 100,
    percent: 80,
    files: 10,
    createdAt: "2026-07-01T00:00:00.000Z",
    ...over,
  };
}

function pr(n: number, branch: string): PROverview {
  return { pr: n, latest: upload({ pr: n, branch }), uploads: 2 };
}

describe("defaultBranchOf", () => {
  it("prefers main, then master, then the first branch", () => {
    expect(defaultBranchOf(["dev", "main", "master"])).toBe("main");
    expect(defaultBranchOf(["dev", "master"])).toBe("master");
    expect(defaultBranchOf(["release", "dev"])).toBe("release");
    expect(defaultBranchOf([])).toBeUndefined();
  });
});

describe("branchItems", () => {
  it("pins the default branch at the top, keeping the rest in order", () => {
    const items = branchItems(["feature/a", "main", "feature/b"]);
    expect(items.map((i) => i.value)).toEqual(["main", "feature/a", "feature/b"]);
    expect(items[0]?.pinned).toBe(true);
    expect(items[1]?.pinned).toBeUndefined();
  });
});

describe("prItems", () => {
  it("labels PRs by number with the branch as detail", () => {
    const items = prItems([pr(128, "feature/checkout-polish")]);
    expect(items[0]).toMatchObject({
      kind: "pr",
      value: "128",
      label: "PR #128",
      detail: "feature/checkout-polish",
    });
  });
});

describe("filterScopeItems", () => {
  const branches = branchItems(["main", "feature/checkout-polish", "Fix/Login"]);
  const prs = prItems([pr(128, "feature/checkout-polish"), pr(42, "hotfix/crash")]);

  it("returns everything for an empty or whitespace query", () => {
    expect(filterScopeItems(branches, "")).toHaveLength(3);
    expect(filterScopeItems(branches, "   ")).toHaveLength(3);
  });

  it("filters case-insensitively on the label", () => {
    expect(filterScopeItems(branches, "CHECKOUT").map((i) => i.value)).toEqual([
      "feature/checkout-polish",
    ]);
    expect(filterScopeItems(branches, "fix/lo").map((i) => i.value)).toEqual(["Fix/Login"]);
  });

  it("matches PRs by number and by branch detail", () => {
    expect(filterScopeItems(prs, "128").map((i) => i.value)).toEqual(["128"]);
    expect(filterScopeItems(prs, "hotfix").map((i) => i.value)).toEqual(["42"]);
  });

  it("returns nothing when the query misses", () => {
    expect(filterScopeItems(branches, "zzz")).toHaveLength(0);
  });
});

describe("moveActive", () => {
  it("moves down and wraps to the top", () => {
    expect(moveActive(3, 0, 1)).toBe(1);
    expect(moveActive(3, 2, 1)).toBe(0);
  });

  it("moves up and wraps to the bottom", () => {
    expect(moveActive(3, 1, -1)).toBe(0);
    expect(moveActive(3, 0, -1)).toBe(2);
  });

  it("handles an empty list and an unset index", () => {
    expect(moveActive(0, 0, 1)).toBe(-1);
    expect(moveActive(3, -1, 1)).toBe(0);
    expect(moveActive(3, -1, -1)).toBe(2);
  });
});

describe("keyActionFor", () => {
  it("maps arrows to moves", () => {
    expect(keyActionFor("ArrowDown", 3, 0)).toEqual({ type: "move", index: 1 });
    expect(keyActionFor("ArrowUp", 3, 0)).toEqual({ type: "move", index: 2 });
  });

  it("selects on Enter only when an option is active", () => {
    expect(keyActionFor("Enter", 3, 1)).toEqual({ type: "select" });
    expect(keyActionFor("Enter", 0, 0)).toBeNull();
    expect(keyActionFor("Enter", 3, 3)).toBeNull();
  });

  it("closes on Escape and ignores typing keys", () => {
    expect(keyActionFor("Escape", 3, 0)).toEqual({ type: "close" });
    expect(keyActionFor("a", 3, 0)).toBeNull();
  });
});
