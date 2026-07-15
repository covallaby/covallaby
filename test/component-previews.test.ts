import { describe, expect, it } from "vitest";
import type { StorybookPreview } from "../web/src/api.js";
import { componentPreviewSections } from "../web/src/pages/component-previews.js";

const preview = (id: number, branch: string, pr: number | null = null): StorybookPreview => ({
  id,
  repo: "acme/app",
  branch,
  pr,
  commit: String(id).repeat(8),
  framework: "storybook",
  status: "complete",
  testsPassed: 0,
  testsFailed: 0,
  testsSkipped: 0,
  durationMs: 0,
  createdAt: new Date(id * 1_000).toISOString(),
  completedAt: new Date(id * 1_000).toISOString(),
});

describe("componentPreviewSections", () => {
  it("keeps the newest main library and one newest diff per PR or branch", () => {
    const sections = componentPreviewSections(
      [
        preview(8, "feature-b", 12),
        preview(7, "main"),
        preview(6, "feature-b", 12),
        preview(5, "feature-a"),
        preview(4, "feature-a"),
        preview(3, "main"),
      ],
      "main",
    );
    expect(sections.current?.id).toBe(7);
    expect(sections.changes.map((item) => item.id)).toEqual([8, 5]);
  });
});
