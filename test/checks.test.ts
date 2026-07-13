import { describe, expect, it } from "vitest";
import type { StorybookPreview, TestRun, UploadRow } from "../web/src/api.js";
import { buildCommitChecks } from "../web/src/checks.js";

const base = { repo: "acme/app", branch: "feature", pr: 12, createdAt: "2026-07-12T12:00:00Z" };
const upload = {
  ...base,
  id: 1,
  commit: "same",
  linesCovered: 90,
  linesTotal: 100,
  percent: 90,
  files: 4,
} satisfies UploadRow;
const run = {
  ...base,
  id: 2,
  commit: "same",
  framework: "playwright",
  status: "complete",
  testsPassed: 6,
  testsFailed: 0,
  testsSkipped: 0,
  durationMs: 1000,
  completedAt: base.createdAt,
} satisfies TestRun;
const preview = {
  ...base,
  id: 3,
  commit: "same",
  framework: "storybook",
  status: "complete",
  testsPassed: 0,
  testsFailed: 0,
  testsSkipped: 0,
  durationMs: 0,
  completedAt: base.createdAt,
  imageCount: 14,
} satisfies StorybookPreview;

describe("commit checks", () => {
  it("joins independent evidence only when the commit SHA matches", () => {
    const [check] = buildCommitChecks([upload], [run], [preview]);
    expect(check).toMatchObject({ commit: "same", status: "ready", missing: [] });
  });

  it("makes missing and failed evidence explicit", () => {
    const partial = buildCommitChecks([upload], [], [])[0]!;
    expect(partial).toMatchObject({ status: "partial", missing: ["journeys", "components"] });
    const failed = buildCommitChecks([], [{ ...run, testsFailed: 1 }], [])[0]!;
    expect(failed.status).toBe("failed");
  });

  it("does not combine evidence from different commits", () => {
    const checks = buildCommitChecks([upload], [{ ...run, commit: "other" }], [preview]);
    expect(checks).toHaveLength(2);
    expect(checks.find((check) => check.commit === "same")?.journey).toBeNull();
  });
});
