import { describe, expect, it } from "vitest";
import type { RepoOverview, ReviewSignals, StorybookPreview, TestRun } from "../web/src/api.js";
import { isSignalKey, summarizeSignals } from "../web/src/components/confidence-signals.js";

const repo = (name: string, percent: number | null = 90): RepoOverview => ({
  repo: name,
  latest: {
    id: 1,
    repo: name,
    branch: "main",
    commit: "abc",
    pr: null,
    createdAt: "2026-07-12T12:00:00Z",
    linesCovered: 90,
    linesTotal: 100,
    percent,
    files: 4,
  },
  trend: [percent],
});

const run = (name: string, tests: Partial<TestRun> = {}): TestRun => ({
  id: 2,
  repo: name,
  branch: "main",
  commit: "abc",
  pr: null,
  framework: "playwright",
  status: "complete",
  testsPassed: 5,
  testsFailed: 1,
  testsSkipped: 2,
  durationMs: 1000,
  createdAt: "2026-07-12T12:00:00Z",
  completedAt: "2026-07-12T12:00:10Z",
  ...tests,
});

const preview = (name: string, imageCount?: number): StorybookPreview => ({
  ...run(name, { testsPassed: 0, testsFailed: 0, testsSkipped: 0 }),
  id: 3,
  framework: "storybook",
  imageCount,
});

const signals = (name: string, runs: TestRun[], previews: StorybookPreview[]): ReviewSignals => ({
  repo: name,
  runs,
  previews,
});

describe("summarizeSignals", () => {
  it("splits every repo into reporting or missing, per signal", () => {
    const repos = [repo("acme/app"), repo("acme/api"), repo("acme/site")];
    const summary = summarizeSignals(repos, [
      signals("acme/app", [run("acme/app")], [preview("acme/app", 14)]),
      signals("acme/api", [run("acme/api")], []),
    ]);
    expect(summary.breakdown.code.reporting).toEqual(["acme/app", "acme/api", "acme/site"]);
    expect(summary.breakdown.code.missing).toEqual([]);
    expect(summary.breakdown.journeys.reporting).toEqual(["acme/app", "acme/api"]);
    expect(summary.breakdown.journeys.missing).toEqual(["acme/site"]);
    expect(summary.breakdown.components.reporting).toEqual(["acme/app"]);
    expect(summary.breakdown.components.missing).toEqual(["acme/api", "acme/site"]);
  });

  it("totals journey tests and component states from each repo's latest evidence only", () => {
    const repos = [repo("acme/app"), repo("acme/api")];
    const summary = summarizeSignals(repos, [
      // Only runs[0]/previews[0] count — older entries must not inflate totals.
      signals(
        "acme/app",
        [run("acme/app"), run("acme/app", { testsPassed: 100 })],
        [preview("acme/app", 14), preview("acme/app", 99)],
      ),
      signals(
        "acme/api",
        [run("acme/api", { testsPassed: 3, testsFailed: 0, testsSkipped: 0 })],
        [],
      ),
    ]);
    expect(summary.journeyTests).toBe(5 + 1 + 2 + 3);
    expect(summary.componentStates).toBe(14);
  });

  it("treats a preview without an image count as reporting zero states", () => {
    const summary = summarizeSignals(
      [repo("acme/app")],
      [signals("acme/app", [], [preview("acme/app", undefined)])],
    );
    expect(summary.breakdown.components.reporting).toEqual(["acme/app"]);
    expect(summary.componentStates).toBe(0);
  });

  it("marks a repo without a measurable percentage as missing code coverage", () => {
    const summary = summarizeSignals([repo("acme/app", null)], []);
    expect(summary.breakdown.code.reporting).toEqual([]);
    expect(summary.breakdown.code.missing).toEqual(["acme/app"]);
  });

  it("ignores signals for repos outside the given list (org-filtered views)", () => {
    const summary = summarizeSignals(
      [repo("acme/app")],
      [signals("other/repo", [run("other/repo")], [preview("other/repo", 50)])],
    );
    expect(summary.journeyTests).toBe(0);
    expect(summary.componentStates).toBe(0);
    expect(summary.breakdown.journeys.missing).toEqual(["acme/app"]);
  });
});

describe("isSignalKey", () => {
  it("accepts only the three signal names, so URL params cannot inject state", () => {
    expect(isSignalKey("code")).toBe(true);
    expect(isSignalKey("journeys")).toBe(true);
    expect(isSignalKey("components")).toBe(true);
    expect(isSignalKey("blended")).toBe(false);
    expect(isSignalKey(null)).toBe(false);
  });
});
