import { Link, useSearchParams } from "react-router-dom";
import { type ActivityItem, shortRepoName } from "../api.js";
import {
  type FeedEntry,
  type FeedFilter,
  type FeedTone,
  buildFeed,
  filterFeed,
  groupFeedByDay,
  parseFeedFilter,
} from "../feed.js";
import { SIGNALS, signalByKey } from "./confidence-signals.js";
import { BranchTag } from "./ui.js";

/**
 * The unified activity feed's rendering, shared by the portfolio overview and
 * the repo Activity tab: one row grammar, the same type chips (via `?type=`),
 * and the same quiet-collapse noise floor. The coverage richness (Δ chips,
 * meters) deliberately stays off these rows — it lives on Summary and the
 * detail pages.
 */

export function ago(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Status-dot colors, matching the review queue's tones. */
const dotFor: Record<FeedTone, string> = {
  good: "bg-(--good)",
  bad: "bg-(--bad)",
  review: "bg-(--accent)",
  muted: "bg-(--muted)",
};

/** One feed row: glyph · dot · (repo badge) · verb · branch · when — one link. */
export function FeedRow({ entry, showRepo = false }: { entry: FeedEntry; showRepo?: boolean }) {
  const Icon = signalByKey[entry.signal].icon;
  const item = entry.item;
  return (
    <Link
      to={entry.href}
      className="group flex items-center gap-2.5 px-4 py-2 transition-colors hover:bg-(--surface-2) sm:px-5"
    >
      <Icon size={15} className="shrink-0 text-(--muted)" aria-hidden="true" />
      <span
        className={`size-1.5 shrink-0 rounded-full ${dotFor[entry.tone]}`}
        aria-hidden="true"
        title={entry.tone}
      />
      <span className="min-w-0 flex-1 truncate">
        {showRepo && (
          <span className="mr-2 inline-block rounded-full border border-(--hairline) bg-(--surface-2) px-2 py-0.5 align-middle font-mono text-[11px] text-(--ink-2)">
            {shortRepoName(item.repo)}
          </span>
        )}
        <span className="align-middle text-[13px] font-medium group-hover:underline">
          {entry.verb}
        </span>
      </span>
      <BranchTag branch={item.branch} pr={item.pr} />
      <span className="w-14 shrink-0 text-right text-xs text-(--muted)">{ago(item.createdAt)}</span>
    </Link>
  );
}

const FILTER_STORAGE_KEY = "covallaby-activity-filter";

const readStoredFilter = (): string | null => {
  try {
    return localStorage.getItem(FILTER_STORAGE_KEY);
  } catch {
    return null;
  }
};

/**
 * Filter chips plus the chronology grouped by day, with unchanged/green events
 * collapsed behind one quiet line per day — the GitHub noise-floor lesson.
 * The active chip is shared via `?type=` and remembered in localStorage.
 */
export function ActivityTimeline({
  items,
  showRepo = false,
  limit = 30,
  loadingText = "Fetching the latest activity…",
  emptyText = "Quiet in here — activity from CI will hop in soon. 🦘",
}: {
  /** Merged feed items, newest first — null while loading. */
  items: ActivityItem[] | null;
  /** Show the repo badge on rows (portfolio feed); off where the repo is fixed. */
  showRepo?: boolean;
  limit?: number;
  loadingText?: string;
  emptyText?: string;
}) {
  const [params, setParams] = useSearchParams();
  const filter = parseFeedFilter(params.get("type") ?? readStoredFilter());
  const setFilter = (next: FeedFilter) => {
    try {
      localStorage.setItem(FILTER_STORAGE_KEY, next);
    } catch {
      // private-mode storage failures shouldn't break the chips
    }
    setParams(
      (prev) => {
        const nextParams = new URLSearchParams(prev);
        if (next === "all") nextParams.delete("type");
        else nextParams.set("type", next);
        return nextParams;
      },
      { replace: true },
    );
  };
  const days = items ? groupFeedByDay(filterFeed(buildFeed(items), filter).slice(0, limit)) : null;
  const chips: Array<{ key: FeedFilter; label: string }> = [
    { key: "all", label: "All" },
    ...SIGNALS.map((signal) => ({ key: signal.key, label: signal.label })),
  ];
  return (
    <>
      <div
        aria-label="Filter activity by signal"
        className="flex flex-wrap items-center gap-1.5 border-b border-(--hairline) px-4 py-2.5 sm:px-5"
      >
        {chips.map((chip) => (
          <button
            key={chip.key}
            type="button"
            aria-pressed={filter === chip.key}
            onClick={() => setFilter(chip.key)}
            className={`rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors ${
              filter === chip.key
                ? "border-(--ink-2) bg-(--surface-2) text-(--ink)"
                : "border-(--hairline) text-(--muted) hover:border-(--muted) hover:text-(--ink-2)"
            }`}
          >
            {chip.label}
          </button>
        ))}
      </div>
      {!days ? (
        <p className="px-5 py-4 text-sm text-(--muted)">{loadingText}</p>
      ) : days.length === 0 ? (
        <p className="px-5 py-4 text-sm text-(--muted)">{emptyText}</p>
      ) : (
        days.map((day) => (
          <section key={day.label} aria-label={day.label}>
            <div className="border-b border-(--hairline) bg-(--surface-2) px-4 py-1.5 text-[11px] font-semibold tracking-wide text-(--muted) uppercase sm:px-5">
              {day.label}
            </div>
            <div className="divide-y divide-(--hairline)">
              {day.loud.map((entry) => (
                <FeedRow key={entry.key} entry={entry} showRepo={showRepo} />
              ))}
            </div>
            {day.quiet.length > 0 && (
              <details className="border-t border-(--hairline)">
                <summary className="cursor-pointer list-none px-4 py-2 text-xs text-(--muted) transition-colors hover:text-(--ink-2) sm:px-5">
                  {day.quiet.length} quiet update{day.quiet.length === 1 ? "" : "s"} — unchanged and
                  green
                </summary>
                <div className="divide-y divide-(--hairline) border-t border-(--hairline)">
                  {day.quiet.map((entry) => (
                    <FeedRow key={entry.key} entry={entry} showRepo={showRepo} />
                  ))}
                </div>
              </details>
            )}
          </section>
        ))
      )}
    </>
  );
}

/** The "coverage-only runtime" footnote, shared by both feed surfaces. */
export function RunsUnsupportedNote() {
  return (
    <p className="border-t border-(--hairline) px-5 py-2.5 text-xs text-(--muted)">
      Journey and component activity isn't available on this runtime yet — showing coverage uploads
      only.
    </p>
  );
}
