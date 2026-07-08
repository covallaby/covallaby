import { describe, expect, it } from "vitest";
import { evaluatePolicy, parsePolicy, renderStatusBadge } from "../src/policy.js";

describe("parsePolicy", () => {
  it("keeps valid rules and drops the rest", () => {
    expect(parsePolicy({ minProject: 80, maxDrop: 1, minNewFile: 90 })).toEqual({
      minProject: 80,
      maxDrop: 1,
      minNewFile: 90,
    });
  });

  it("rejects out-of-range and non-numeric values", () => {
    expect(parsePolicy({ minProject: 120 })).toBeNull();
    expect(parsePolicy({ minProject: -5 })).toBeNull();
    expect(parsePolicy({ minProject: "80" })).toBeNull();
    expect(parsePolicy({ minProject: Number.NaN })).toBeNull();
  });

  it("treats an empty or non-object policy as no policy", () => {
    expect(parsePolicy({})).toBeNull();
    expect(parsePolicy(null)).toBeNull();
    expect(parsePolicy("nope")).toBeNull();
    expect(parsePolicy({ nonsense: 1 })).toBeNull();
  });
});

describe("evaluatePolicy", () => {
  it("passes everything when no policy is configured", () => {
    const r = evaluatePolicy(null, { projectPercent: 12 });
    expect(r).toEqual({ configured: false, passed: true, violations: [] });
  });

  it("enforces the project floor and floors to one decimal", () => {
    expect(evaluatePolicy({ minProject: 85 }, { projectPercent: 90 }).passed).toBe(true);
    // 84.97 displays as 84.9%, so it must fail an 85 floor (no rounding up).
    const fail = evaluatePolicy({ minProject: 85 }, { projectPercent: 84.97 });
    expect(fail.passed).toBe(false);
    expect(fail.violations[0]?.kind).toBe("project");
    // 85.04 floors to 85.0 — meets the floor exactly.
    expect(evaluatePolicy({ minProject: 85 }, { projectPercent: 85.04 }).passed).toBe(true);
  });

  it("fails the project floor when there are no coverable lines", () => {
    const r = evaluatePolicy({ minProject: 1 }, { projectPercent: null });
    expect(r.passed).toBe(false);
    expect(r.violations[0]?.message).toContain("no coverable lines");
  });

  it("enforces maxDrop only when a base exists", () => {
    // No base → drop rule is skipped.
    expect(evaluatePolicy({ maxDrop: 0 }, { projectPercent: 50 }).passed).toBe(true);
    // Dropped a full point with a zero-tolerance policy → fail.
    const drop = evaluatePolicy({ maxDrop: 0 }, { projectPercent: 79, basePercent: 80 });
    expect(drop.passed).toBe(false);
    expect(drop.violations[0]?.kind).toBe("drop");
    // A rise never trips the drop rule.
    expect(evaluatePolicy({ maxDrop: 0 }, { projectPercent: 81, basePercent: 80 }).passed).toBe(
      true,
    );
    // Within tolerance.
    expect(evaluatePolicy({ maxDrop: 1 }, { projectPercent: 79.5, basePercent: 80 }).passed).toBe(
      true,
    );
  });

  it("enforces the new-file floor and ignores 0-line files", () => {
    const r = evaluatePolicy(
      { minNewFile: 80 },
      {
        projectPercent: 90,
        addedFiles: [
          { path: "src/new.ts", percent: 40 },
          { path: "src/ok.ts", percent: 95 },
          { path: "src/types.ts", percent: null }, // no coverable lines → pass
        ],
      },
    );
    expect(r.passed).toBe(false);
    expect(r.violations[0]?.kind).toBe("new-file");
    expect(r.violations[0]?.message).toContain("src/new.ts");
    expect(r.violations[0]?.message).not.toContain("src/types.ts");
  });

  it("reports every failing rule at once", () => {
    const r = evaluatePolicy(
      { minProject: 90, maxDrop: 0, minNewFile: 90 },
      {
        projectPercent: 70,
        basePercent: 80,
        addedFiles: [{ path: "a.ts", percent: 10 }],
      },
    );
    expect(r.passed).toBe(false);
    expect(r.violations.map((v) => v.kind).sort()).toEqual(["drop", "new-file", "project"]);
  });
});

describe("renderStatusBadge", () => {
  it("renders passing, failing, and no-policy states", () => {
    expect(renderStatusBadge(true)).toContain("passing");
    expect(renderStatusBadge(false)).toContain("failing");
    expect(renderStatusBadge(null)).toContain("no policy");
  });

  it("escapes untrusted labels", () => {
    const svg = renderStatusBadge(true, '<script>"x"');
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
  });
});
