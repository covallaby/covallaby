import { describe, expect, it } from "vitest";
import type { ActivityItem, TestRun, UploadRow } from "../web/src/api.js";
import {
  buildFeed,
  dayLabel,
  filterFeed,
  groupFeedByDay,
  parseFeedFilter,
} from "../web/src/feed.js";

const upload = (over: Partial<UploadRow>): ActivityItem => ({
  type: "coverage",
  id: 1,
  repo: "acme/app",
  branch: "main",
  commit: "c0ffee1",
  pr: null,
  linesCovered: 842,
  linesTotal: 1000,
  percent: 84.2,
  files: 12,
  baseSha: null,
  createdAt: "2026-07-14T10:00:00.000Z",
  ...over,
});

const run = (type: "journeys" | "components", over: Partial<TestRun>): ActivityItem => ({
  type,
  id: 10,
  repo: "acme/app",
  branch: "main",
  commit: "c0ffee2",
  pr: null,
  framework: type === "components" ? "storybook" : "playwright",
  status: "complete",
  testsPassed: 34,
  testsFailed: 0,
  testsSkipped: 0,
  durationMs: 1000,
  reviewState: "auto-accepted",
  imageCount: null,
  createdAt: "2026-07-14T09:00:00.000Z",
  completedAt: "2026-07-14T09:01:00.000Z",
  ...over,
});

describe("buildFeed verb grammar and tones", () => {
  it("shows the coverage arrow against the prior upload on the same repo+branch", () => {
    const entries = buildFeed([
      upload({ id: 3, percent: 81.9, createdAt: "2026-07-14T10:00:00.000Z" }),
      upload({ id: 2, branch: "feat/x", percent: 50, createdAt: "2026-07-13T10:00:00.000Z" }),
      upload({ id: 1, percent: 84.2, createdAt: "2026-07-12T10:00:00.000Z" }),
    ]);
    // The feat/x upload in between never becomes main's baseline.
    expect(entries[0]).toMatchObject({
      verb: "coverage 84.2% → 81.9%",
      tone: "review",
      quiet: false,
      signal: "code",
      href: "/r/acme/app/u/3",
    });
    // A gain reads good; the window's oldest upload has no visible prior.
    expect(buildFeed([upload({ percent: 90 }), upload({ id: 0, percent: 84.2 })])[0]).toMatchObject(
      { verb: "coverage 84.2% → 90.0%", tone: "good" },
    );
    expect(entries[2]).toMatchObject({ verb: "coverage 84.2%", quiet: false });
  });

  it("collapses steady coverage behind the noise floor", () => {
    const entries = buildFeed([
      upload({ id: 2, percent: 84.21 }),
      upload({ id: 1, percent: 84.2, createdAt: "2026-07-13T10:00:00.000Z" }),
    ]);
    expect(entries[0]).toMatchObject({
      verb: "coverage steady at 84.2%",
      tone: "muted",
      quiet: true,
    });
  });

  it("grades journey runs: failures loud, green runs quiet", () => {
    expect(buildFeed([run("journeys", { testsPassed: 31, testsFailed: 1 })])[0]).toMatchObject({
      verb: "1 of 32 journeys failed",
      tone: "bad",
      quiet: false,
      href: "/r/acme/app/test-runs/10",
    });
    expect(buildFeed([run("journeys", { testsSkipped: 2 })])[0]).toMatchObject({
      verb: "34 journeys passed · 2 skipped",
      tone: "good",
      quiet: true,
    });
    expect(buildFeed([run("journeys", { status: "failed", testsPassed: 0 })])[0]).toMatchObject({
      verb: "journey run failed",
      tone: "bad",
      quiet: false,
    });
  });

  it("grades component runs by review verdict", () => {
    expect(buildFeed([run("components", { reviewState: "pending" })])[0]).toMatchObject({
      verb: "component changes need review",
      tone: "review",
      quiet: false,
      signal: "components",
      href: "/r/acme/app/storybook-previews/10",
    });
    expect(buildFeed([run("components", { reviewState: "rejected" })])[0]).toMatchObject({
      verb: "component changes rejected",
      tone: "bad",
      quiet: false,
    });
    expect(buildFeed([run("components", { imageCount: 24 })])[0]).toMatchObject({
      verb: "24 component states captured",
      tone: "good",
      quiet: true,
    });
    // Pre-column rows without a count still read sensibly.
    expect(buildFeed([run("components", {})])[0]!.verb).toBe("component states captured");
  });
});

describe("filters", () => {
  const entries = buildFeed([
    upload({}),
    run("journeys", { id: 11 }),
    run("components", { id: 12 }),
  ]);

  it("maps chips to signals and passes everything through All", () => {
    expect(filterFeed(entries, "all")).toHaveLength(3);
    expect(filterFeed(entries, "code").map((e) => e.signal)).toEqual(["code"]);
    expect(filterFeed(entries, "journeys").map((e) => e.signal)).toEqual(["journeys"]);
    expect(filterFeed(entries, "components").map((e) => e.signal)).toEqual(["components"]);
  });

  it("parses the ?type= param defensively", () => {
    expect(parseFeedFilter("journeys")).toBe("journeys");
    expect(parseFeedFilter("code")).toBe("code");
    expect(parseFeedFilter("nonsense")).toBe("all");
    expect(parseFeedFilter(null)).toBe("all");
    expect(parseFeedFilter(undefined)).toBe("all");
  });
});

describe("day grouping", () => {
  // Day labels follow the viewer's local calendar, so build local timestamps
  // to keep the assertions timezone-independent.
  const now = new Date(2026, 6, 14, 12, 0, 0);
  const local = (y: number, m: number, d: number, h: number) => new Date(y, m, d, h).toISOString();

  it("labels days relative to now and never groups by repo", () => {
    expect(dayLabel(local(2026, 6, 14, 1), now)).toBe("Today");
    expect(dayLabel(local(2026, 6, 13, 23), now)).toBe("Yesterday");
    expect(dayLabel(local(2026, 6, 11, 10), now)).toBe("July 11");
    expect(dayLabel(local(2025, 11, 31, 10), now)).toBe("December 31, 2025");
  });

  it("buckets entries per day, splitting loud rows from quiet ones", () => {
    const days = groupFeedByDay(
      buildFeed([
        run("journeys", { id: 21, testsFailed: 1, createdAt: local(2026, 6, 14, 9) }),
        run("components", { id: 20, imageCount: 5, createdAt: local(2026, 6, 14, 8) }),
        run("journeys", { id: 19, createdAt: local(2026, 6, 13, 9) }),
      ]),
      now,
    );
    expect(days.map((d) => d.label)).toEqual(["Today", "Yesterday"]);
    expect(days[0]!.loud.map((e) => e.key)).toEqual(["journeys-21"]);
    expect(days[0]!.quiet.map((e) => e.key)).toEqual(["components-20"]);
    expect(days[1]!.loud).toEqual([]);
    expect(days[1]!.quiet.map((e) => e.key)).toEqual(["journeys-19"]);
  });
});
