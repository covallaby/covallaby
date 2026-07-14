import type { ActivityItem } from "./api.js";
import { formatPercent } from "./api.js";
import type { SignalKey } from "./components/confidence-signals.js";
import { isSignalKey } from "./components/confidence-signals.js";

/**
 * Pure logic for the portfolio's unified activity feed: verb grammar, tones,
 * the quiet/loud noise floor, filter chips, and day grouping. Kept free of
 * React so the feed's behavior is unit-testable.
 */

export type FeedFilter = "all" | SignalKey;

/** Status-dot tone for one feed row. */
export type FeedTone = "good" | "bad" | "review" | "muted";

export interface FeedEntry {
  /** Stable per-row key ("coverage-12", "journeys-42", …). */
  key: string;
  item: ActivityItem;
  /** Which confidence signal the row belongs to (drives glyph + filters). */
  signal: SignalKey;
  /** One-line verb grammar, e.g. `coverage 84.2% → 81.9%` or `34 journeys passed`. */
  verb: string;
  tone: FeedTone;
  /**
   * Quiet rows are unchanged/green events (steady coverage, all-passing
   * journeys, accepted captures). The default view collapses them behind a
   * "N quiet updates" line — the GitHub noise-floor lesson.
   */
  quiet: boolean;
  /** The row's single destination: the item's canonical detail page. */
  href: string;
}

const signalOf = (item: ActivityItem): SignalKey => (item.type === "coverage" ? "code" : item.type);

const hrefOf = (item: ActivityItem): string =>
  item.type === "coverage"
    ? `/r/${item.repo}/u/${item.id}`
    : item.type === "journeys"
      ? `/r/${item.repo}/test-runs/${item.id}`
      : `/r/${item.repo}/storybook-previews/${item.id}`;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Build renderable feed entries from the merged API items (newest first).
 * Coverage deltas are resolved against the previous upload on the same
 * repo+branch *within the fetched window* — enough for the arrow grammar
 * without another server round-trip; a row with no visible prior just shows
 * its absolute percentage.
 */
export function buildFeed(items: ActivityItem[]): FeedEntry[] {
  return items.map((item, index) => {
    const base = {
      key: `${item.type}-${item.id}`,
      item,
      signal: signalOf(item),
      href: hrefOf(item),
    };
    if (item.type === "coverage") {
      const prior = items.find(
        (candidate, at): candidate is ActivityItem & { type: "coverage" } =>
          at > index &&
          candidate.type === "coverage" &&
          candidate.repo === item.repo &&
          candidate.branch === item.branch,
      );
      if (prior && prior.percent !== null && item.percent !== null) {
        const delta = item.percent - prior.percent;
        if (Math.abs(delta) < 0.05) {
          return {
            ...base,
            verb: `coverage steady at ${formatPercent(item.percent)}`,
            tone: "muted" as const,
            quiet: true,
          };
        }
        return {
          ...base,
          verb: `coverage ${formatPercent(prior.percent)} → ${formatPercent(item.percent)}`,
          tone: delta < 0 ? ("review" as const) : ("good" as const),
          quiet: false,
        };
      }
      return {
        ...base,
        verb: `coverage ${formatPercent(item.percent)}`,
        tone: item.percent === null ? ("muted" as const) : ("good" as const),
        quiet: false,
      };
    }
    if (item.type === "journeys") {
      if (item.testsFailed > 0) {
        return {
          ...base,
          verb: `${item.testsFailed} of ${plural(item.testsPassed + item.testsFailed, "journey")} failed`,
          tone: "bad" as const,
          quiet: false,
        };
      }
      if (item.status === "failed") {
        return { ...base, verb: "journey run failed", tone: "bad" as const, quiet: false };
      }
      if (item.status === "uploading") {
        return { ...base, verb: "journey run publishing…", tone: "muted" as const, quiet: true };
      }
      return {
        ...base,
        verb: `${plural(item.testsPassed, "journey")} passed${
          item.testsSkipped ? ` · ${item.testsSkipped} skipped` : ""
        }`,
        tone: "good" as const,
        quiet: true,
      };
    }
    // Components: the review verdict is the story.
    if (item.status === "failed") {
      return { ...base, verb: "component capture run failed", tone: "bad" as const, quiet: false };
    }
    if (item.status === "uploading") {
      return {
        ...base,
        verb: "component captures publishing…",
        tone: "muted" as const,
        quiet: true,
      };
    }
    const states =
      item.imageCount !== null && item.imageCount !== undefined
        ? `${plural(item.imageCount, "component state")} captured`
        : "component states captured";
    switch (item.reviewState) {
      case "rejected":
        return { ...base, verb: "component changes rejected", tone: "bad" as const, quiet: false };
      case "pending":
        return {
          ...base,
          verb: "component changes need review",
          tone: "review" as const,
          quiet: false,
        };
      case "approved":
        return { ...base, verb: "component changes approved", tone: "good" as const, quiet: true };
      default:
        // auto-accepted (or older runs with no verdict): a routine green event.
        return { ...base, verb: states, tone: "good" as const, quiet: true };
    }
  });
}

export function filterFeed(entries: FeedEntry[], filter: FeedFilter): FeedEntry[] {
  return filter === "all" ? entries : entries.filter((entry) => entry.signal === filter);
}

export function parseFeedFilter(value: string | null | undefined): FeedFilter {
  return value != null && isSignalKey(value) ? value : "all";
}

/** "Today", "Yesterday", or a calendar date — repo is never a grouping level. */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const when = new Date(iso);
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(when)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return when.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    ...(when.getFullYear() !== now.getFullYear() && { year: "numeric" }),
  });
}

export interface FeedDay {
  label: string;
  /** Changes, failures, and needs-review — always rendered. */
  loud: FeedEntry[];
  /** Unchanged/green events, collapsed behind one quiet line per day. */
  quiet: FeedEntry[];
}

/** Group entries (newest first) into day buckets, splitting loud from quiet. */
export function groupFeedByDay(entries: FeedEntry[], now: Date = new Date()): FeedDay[] {
  const days: FeedDay[] = [];
  for (const entry of entries) {
    const label = dayLabel(entry.item.createdAt, now);
    let day = days[days.length - 1];
    if (!day || day.label !== label) {
      day = { label, loud: [], quiet: [] };
      days.push(day);
    }
    (entry.quiet ? day.quiet : day.loud).push(entry);
  }
  return days;
}
