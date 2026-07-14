import { describe, expect, it } from "vitest";
import type { StorybookCapture } from "../web/src/api.js";
import {
  buildReviewStops,
  diffGroupKey,
  isChange,
  parseReviewFilter,
  parseReviewView,
  reviewKeyAction,
  stepStop,
  stopIndexOf,
} from "../web/src/pages/storybook-review.js";

const capture = (
  id: string,
  status: StorybookCapture["status"],
  hashes: { sha256?: string; baselineSha256?: string } = {},
): StorybookCapture => ({
  artifactId: 1,
  id,
  title: `Components/${id}`,
  name: id,
  imageUrl: `https://previews.test/${id}.png`,
  status,
  ...hashes,
});

describe("buildReviewStops", () => {
  const captures = [
    capture("unchanged-a", "unchanged", { sha256: "s", baselineSha256: "s" }),
    capture("changed-a", "changed", { sha256: "new1", baselineSha256: "old1" }),
    capture("changed-b", "changed", { sha256: "new1", baselineSha256: "old1" }),
    capture("added-a", "new", { sha256: "new2" }),
    capture("changed-c", "changed", { sha256: "new3", baselineSha256: "old3" }),
    capture("removed-a", "removed", { baselineSha256: "old4" }),
  ];

  it("leads with changes and hides unchanged captures by default", () => {
    const stops = buildReviewStops(captures, "changes");
    expect(stops.flatMap((stop) => stop.captures.map((c) => c.id))).not.toContain("unchanged-a");
    expect(stops[0]!.captures[0]!.status).toBe("changed");
  });

  it("groups changed stories that share the same (baseline, new) hash pair", () => {
    const stops = buildReviewStops(captures, "changes");
    const group = stops.find((stop) => stop.captures.length > 1);
    expect(group).toBeDefined();
    expect(group!.captures.map((c) => c.id)).toEqual(["changed-a", "changed-b"]);
    // changed-c has a different hash pair, so it stays its own stop.
    expect(stops.filter((stop) => stop.captures.length > 1)).toHaveLength(1);
    // 6 captures → group(2) + changed-c + added-a + removed-a = 4 stops.
    expect(stops).toHaveLength(4);
  });

  it("never groups captures that lack either hash", () => {
    const stops = buildReviewStops(
      [
        capture("x", "changed", { sha256: "same" }),
        capture("y", "changed", { sha256: "same" }),
        capture("z", "changed"),
      ],
      "changes",
    );
    expect(stops).toHaveLength(3);
  });

  it("shows unchanged captures after changes when showing all", () => {
    const stops = buildReviewStops(captures, "all");
    const ids = stops.flatMap((stop) => stop.captures.map((c) => c.id));
    expect(ids).toContain("unchanged-a");
    expect(ids.indexOf("unchanged-a")).toBe(ids.length - 1);
  });

  it("filters by search query across title and name", () => {
    const stops = buildReviewStops(captures, "all", "removed-a");
    expect(stops).toHaveLength(1);
    expect(stops[0]!.captures[0]!.id).toBe("removed-a");
  });

  it("filters to a single status", () => {
    const stops = buildReviewStops(captures, "removed");
    expect(stops.map((stop) => stop.captures[0]!.id)).toEqual(["removed-a"]);
  });
});

describe("stepStop", () => {
  const stops = buildReviewStops(
    [
      capture("changed-a", "changed", { sha256: "n1", baselineSha256: "o1" }),
      capture("changed-b", "changed", { sha256: "n1", baselineSha256: "o1" }),
      capture("added-a", "new", { sha256: "n2" }),
    ],
    "changes",
  );

  it("treats a whole group as one stop in the loop", () => {
    // From either member of the group, next lands past the entire group.
    expect(stepStop(stops, "changed-a", 1)?.id).toBe("added-a");
    expect(stepStop(stops, "changed-b", 1)?.id).toBe("added-a");
    // And prev from the story after the group lands on the group head.
    expect(stepStop(stops, "added-a", -1)?.id).toBe("changed-a");
  });

  it("clamps at both ends", () => {
    expect(stepStop(stops, "changed-a", -1)?.id).toBe("changed-a");
    expect(stepStop(stops, "added-a", 1)?.id).toBe("added-a");
  });

  it("enters the list from an unknown or empty selection", () => {
    expect(stepStop(stops, null, 1)?.id).toBe("changed-a");
    expect(stepStop(stops, "not-a-story", -1)?.id).toBe("added-a");
    expect(stepStop([], "changed-a", 1)).toBeNull();
  });

  it("locates the stop containing any group member", () => {
    expect(stopIndexOf(stops, "changed-b")).toBe(0);
    expect(stopIndexOf(stops, "added-a")).toBe(1);
    expect(stopIndexOf(stops, null)).toBe(-1);
  });
});

describe("reviewKeyAction", () => {
  const free = { editable: false, modifier: false };

  it("maps the review keys", () => {
    expect(reviewKeyAction("j", free)).toBe("next");
    expect(reviewKeyAction("ArrowDown", free)).toBe("next");
    expect(reviewKeyAction("k", free)).toBe("prev");
    expect(reviewKeyAction("ArrowUp", free)).toBe("prev");
    expect(reviewKeyAction("d", free)).toBe("toggle-diff");
    expect(reviewKeyAction("b", free)).toBe("swap");
    expect(reviewKeyAction("a", free)).toBeNull();
    expect(reviewKeyAction("Enter", free)).toBeNull();
  });

  it("never hijacks typing or browser shortcuts", () => {
    expect(reviewKeyAction("j", { editable: true, modifier: false })).toBeNull();
    expect(reviewKeyAction("d", { editable: false, modifier: true })).toBeNull();
  });
});

describe("URL parameter parsing", () => {
  it("defaults to changed-only and side-by-side for unknown values", () => {
    expect(parseReviewFilter(null)).toBe("changes");
    expect(parseReviewFilter("bogus")).toBe("changes");
    expect(parseReviewFilter("all")).toBe("all");
    expect(parseReviewFilter("unchanged")).toBe("unchanged");
    expect(parseReviewView(null)).toBe("side-by-side");
    expect(parseReviewView("bogus")).toBe("side-by-side");
    expect(parseReviewView("overlay")).toBe("overlay");
    expect(parseReviewView("diff")).toBe("diff");
  });
});

describe("change semantics", () => {
  it("counts stories without a baseline as added", () => {
    expect(isChange(capture("a", "new"))).toBe(true);
    expect(isChange(capture("a", "changed"))).toBe(true);
    expect(isChange(capture("a", "removed"))).toBe(true);
    expect(isChange(capture("a", "unchanged"))).toBe(false);
    expect(isChange(capture("a", "uncompared"))).toBe(false);
  });

  it("only changed captures with both hashes get a group identity", () => {
    expect(diffGroupKey(capture("a", "changed", { sha256: "n", baselineSha256: "o" }))).toBe("o→n");
    expect(diffGroupKey(capture("a", "changed", { sha256: "n" }))).toBeNull();
    expect(diffGroupKey(capture("a", "new", { sha256: "n", baselineSha256: "o" }))).toBeNull();
  });
});
