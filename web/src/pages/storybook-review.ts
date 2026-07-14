import type { StorybookCapture } from "../api.js";

/**
 * Pure logic behind the Storybook visual review loop: which captures are
 * "changes", how identical diffs collapse into one review stop, and how
 * keyboard input maps onto review actions. Kept free of React so it can be
 * unit-tested directly.
 */

export type ReviewFilter = "changes" | "all" | StorybookCapture["status"];

export const REVIEW_FILTERS: readonly ReviewFilter[] = [
  "changes",
  "all",
  "changed",
  "new",
  "removed",
  "unchanged",
  "uncompared",
];

export function parseReviewFilter(value: string | null): ReviewFilter {
  return REVIEW_FILTERS.includes(value as ReviewFilter) ? (value as ReviewFilter) : "changes";
}

export type ReviewView = "side-by-side" | "overlay" | "diff";

export const REVIEW_VIEWS: readonly ReviewView[] = ["side-by-side", "overlay", "diff"];

export function parseReviewView(value: string | null): ReviewView {
  return REVIEW_VIEWS.includes(value as ReviewView) ? (value as ReviewView) : "side-by-side";
}

/** New stories count as changes too: with no baseline they're "added". */
export function isChange(capture: StorybookCapture): boolean {
  return capture.status === "changed" || capture.status === "new" || capture.status === "removed";
}

export function matchesFilter(capture: StorybookCapture, filter: ReviewFilter): boolean {
  if (filter === "all") return true;
  if (filter === "changes") return isChange(capture);
  return capture.status === filter;
}

export function matchesQuery(capture: StorybookCapture, query: string): boolean {
  return `${capture.title} ${capture.name}`.toLowerCase().includes(query.trim().toLowerCase());
}

/**
 * Identity of a capture's visual change. Two changed stories whose baseline
 * and current screenshots hash identically show the exact same pixel diff, so
 * they review as one stop. Captures without both hashes never group.
 */
export function diffGroupKey(capture: StorybookCapture): string | null {
  if (capture.status !== "changed" || !capture.sha256 || !capture.baselineSha256) return null;
  return `${capture.baselineSha256}→${capture.sha256}`;
}

/** One stop in the j/k review loop: a single capture, or a group sharing one identical diff. */
export interface ReviewStop {
  /** Stable key — the shared diff identity for groups, the capture id otherwise. */
  key: string;
  captures: StorybookCapture[];
}

const STATUS_ORDER: Record<StorybookCapture["status"], number> = {
  changed: 0,
  new: 1,
  removed: 2,
  uncompared: 3,
  unchanged: 4,
};

/**
 * Filter, order (changes lead), and group captures into review stops. Order
 * within a status band is the server's capture order, which keeps stops stable
 * as filters change.
 */
export function buildReviewStops(
  captures: StorybookCapture[],
  filter: ReviewFilter,
  query = "",
): ReviewStop[] {
  const visible = captures
    .filter((capture) => matchesFilter(capture, filter) && matchesQuery(capture, query))
    .map((capture, index) => ({ capture, index }))
    .sort(
      (a, b) =>
        STATUS_ORDER[a.capture.status] - STATUS_ORDER[b.capture.status] || a.index - b.index,
    )
    .map(({ capture }) => capture);
  const stops: ReviewStop[] = [];
  const groups = new Map<string, ReviewStop>();
  for (const capture of visible) {
    const key = diffGroupKey(capture);
    if (key) {
      const existing = groups.get(key);
      if (existing) {
        existing.captures.push(capture);
        continue;
      }
      const stop = { key, captures: [capture] };
      groups.set(key, stop);
      stops.push(stop);
    } else {
      stops.push({ key: capture.id, captures: [capture] });
    }
  }
  return stops;
}

/** Index of the stop containing the capture, or -1. */
export function stopIndexOf(stops: ReviewStop[], captureId: string | null): number {
  if (captureId === null) return -1;
  return stops.findIndex((stop) => stop.captures.some((capture) => capture.id === captureId));
}

/**
 * The capture selected after moving `delta` stops from the one containing
 * `captureId`. A whole group is a single stop, so j/k skips its members.
 * Clamps at both ends; from an unknown selection, moving lands on an edge.
 */
export function stepStop(
  stops: ReviewStop[],
  captureId: string | null,
  delta: number,
): StorybookCapture | null {
  if (stops.length === 0) return null;
  const current = stopIndexOf(stops, captureId);
  const target =
    current === -1
      ? delta > 0
        ? 0
        : stops.length - 1
      : Math.min(stops.length - 1, Math.max(0, current + delta));
  return stops[target]!.captures[0]!;
}

export type ReviewKeyAction = "next" | "prev" | "toggle-diff" | "swap";

/**
 * Map a keydown to a review action. Returns null (leave the event alone) when
 * focus is in an editable element or a modifier is held, so typing in the
 * search box and browser shortcuts keep working.
 */
export function reviewKeyAction(
  key: string,
  options: { editable: boolean; modifier: boolean },
): ReviewKeyAction | null {
  if (options.editable || options.modifier) return null;
  switch (key) {
    case "j":
    case "ArrowDown":
      return "next";
    case "k":
    case "ArrowUp":
      return "prev";
    case "d":
      return "toggle-diff";
    case "b":
      return "swap";
    default:
      return null;
  }
}

/** True when a keydown target is a place the user types, so review keys must not fire. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof Element)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    (target as HTMLElement).isContentEditable
  );
}
