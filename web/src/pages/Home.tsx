import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  type ActivityFeed,
  type PortfolioTrends,
  type RepoOverview,
  api,
  formatPercent,
  groupReposByOwner,
  severity,
  shortRepoName,
} from "../api.js";
import mascotUrl from "../assets/mascot.png";
import { Sparkline } from "../components/charts.js";
import { SIGNALS, signalByKey } from "../components/confidence-signals.js";
import {
  PortfolioConfidenceCoverage,
  PortfolioReviewQueue,
} from "../components/review-overview.js";
import { Skeleton } from "../components/skeleton.js";
import {
  BranchTag,
  Card,
  CardFooter,
  CardHeader,
  DeltaChip,
  Meter,
  OwnerAvatar,
  inkFor,
} from "../components/ui.js";
import { CoverageDebt, RiskQuadrant } from "../components/viz.js";
import {
  type FeedEntry,
  type FeedFilter,
  type FeedTone,
  buildFeed,
  filterFeed,
  groupFeedByDay,
  parseFeedFilter,
} from "../feed.js";

/** Absolute coverage movement across the repo's trend — used to surface movers first. */
function momentum(r: RepoOverview): number {
  const pts = r.trend.filter((p): p is number => p !== null);
  return pts.length >= 2 ? Math.abs(pts[pts.length - 1]! - pts[0]!) : 0;
}

/** One repository card in an org group — shows just the repo name (owner is the section header). */
function RepoCard({ r }: { r: RepoOverview }) {
  const prev = r.trend.length > 1 ? r.trend[r.trend.length - 2] : null;
  return (
    <Link to={`/r/${r.repo}`} className="group">
      <Card className="p-5 transition-all duration-150 group-hover:-translate-y-0.5 group-hover:border-(--muted)">
        <div className="mb-4 flex items-center justify-between font-mono text-[13px] text-(--ink-2)">
          <span className="min-w-0 truncate">{shortRepoName(r.repo)}</span>
          <span className="text-(--muted)">{r.latest.branch}</span>
        </div>
        <div className="flex items-end justify-between gap-3">
          <div>
            <div
              className={`text-[34px] leading-none font-semibold tracking-tight ${inkFor[severity(r.latest.percent)]}`}
            >
              {formatPercent(r.latest.percent)}
            </div>
            <div className="mt-2 flex items-center gap-2 text-xs whitespace-nowrap text-(--muted)">
              {r.latest.linesCovered.toLocaleString()} of {r.latest.linesTotal.toLocaleString()}{" "}
              lines <DeltaChip current={r.latest.percent} previous={prev} />
            </div>
          </div>
          <Sparkline points={r.trend} />
        </div>
        <Meter percent={r.latest.percent} className="mt-4" />
      </Card>
    </Link>
  );
}

function ago(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function Tile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <Card>
      <div className="px-5 pt-4 pb-3">
        <div className="text-xs text-(--muted)">{label}</div>
        <div className="mt-1.5 text-[26px] leading-none font-semibold tracking-tight">{value}</div>
      </div>
      <CardFooter>{sub ?? "\u00a0"}</CardFooter>
    </Card>
  );
}

/** Status-dot colors, matching the review queue's tones. */
const dotFor: Record<FeedTone, string> = {
  good: "bg-(--good)",
  bad: "bg-(--bad)",
  review: "bg-(--accent)",
  muted: "bg-(--muted)",
};

/** One feed row: glyph · dot · repo badge · verb · branch · when — one link. */
function FeedRow({ entry }: { entry: FeedEntry }) {
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
        <span className="mr-2 inline-block rounded-full border border-(--hairline) bg-(--surface-2) px-2 py-0.5 align-middle font-mono text-[11px] text-(--ink-2)">
          {shortRepoName(item.repo)}
        </span>
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
 * The unified three-signal activity feed: needs-review pinned on top, filter
 * chips, then the chronology grouped by day with unchanged/green events
 * collapsed behind one quiet line per day.
 */
function ActivityFeedCard({
  repos,
  feed,
  orgFilter,
}: {
  repos: RepoOverview[];
  feed: ActivityFeed | null;
  orgFilter: string | null;
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
  const items = orgFilter
    ? (feed?.items ?? []).filter((item) => item.repo.split("/")[0] === orgFilter)
    : (feed?.items ?? []);
  const days = feed ? groupFeedByDay(filterFeed(buildFeed(items), filter).slice(0, 30)) : null;
  const chips: Array<{ key: FeedFilter; label: string }> = [
    { key: "all", label: "All" },
    ...SIGNALS.map((signal) => ({ key: signal.key, label: signal.label })),
  ];
  return (
    <Card className="mb-4 overflow-hidden">
      <CardHeader
        title="Recent activity"
        description="Coverage, journeys, and component captures across every repository — one feed, three signals"
      />
      <PortfolioReviewQueue repos={repos} />
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
        <p className="px-5 py-4 text-sm text-(--muted)">Fetching the latest activity…</p>
      ) : days.length === 0 ? (
        <p className="px-5 py-4 text-sm text-(--muted)">
          Quiet in here — activity from CI will hop in soon. 🦘
        </p>
      ) : (
        days.map((day) => (
          <section key={day.label} aria-label={day.label}>
            <div className="border-b border-(--hairline) bg-(--surface-2) px-4 py-1.5 text-[11px] font-semibold tracking-wide text-(--muted) uppercase sm:px-5">
              {day.label}
            </div>
            <div className="divide-y divide-(--hairline)">
              {day.loud.map((entry) => (
                <FeedRow key={entry.key} entry={entry} />
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
                    <FeedRow key={entry.key} entry={entry} />
                  ))}
                </div>
              </details>
            )}
          </section>
        ))
      )}
      {feed && !feed.runsSupported && (
        <p className="border-t border-(--hairline) px-5 py-2.5 text-xs text-(--muted)">
          Journey and component activity isn't available on this runtime yet — showing coverage
          uploads only.
        </p>
      )}
    </Card>
  );
}

export function Home({ repos }: { repos: RepoOverview[] | null }) {
  const { owner } = useParams();
  const [feed, setFeed] = useState<ActivityFeed | null>(null);
  const [trends, setTrends] = useState<PortfolioTrends | null>(null);
  useEffect(() => {
    api
      .activity()
      .then(setFeed)
      .catch(() => setFeed({ uploads: [], items: [], runsSupported: true }));
    api
      .trends()
      .then(setTrends)
      .catch(() => setTrends(null));
  }, []);

  if (!repos) {
    return (
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className="p-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-3 h-7 w-16" />
          </Card>
        ))}
      </div>
    );
  }

  if (repos.length === 0) {
    return (
      <Card className="mx-auto mt-12 max-w-xl p-7 text-center">
        <img
          src={mascotUrl}
          alt="The Covallaby wallaby holding a coverage checklist"
          className="mx-auto mb-4 w-40"
        />
        <h2 className="text-lg font-semibold tracking-tight">No coverage yet — let's fix that</h2>
        <p className="mt-2 text-sm text-(--ink-2)">
          Upload any coverage file (LCOV, JaCoCo, Cobertura, xccov) from CI or your machine:
        </p>
        <pre className="mt-4 overflow-x-auto rounded-xl border border-(--hairline) bg-(--surface-2) p-4 text-left font-mono text-xs leading-relaxed">
          {`curl -X POST "$SERVER/api/v1/upload?repo=you/app&branch=main&commit=$(git rev-parse HEAD)" \\
  -H "Authorization: Bearer $COVALLABY_TOKEN" \\
  --data-binary @coverage/lcov.info`}
        </pre>
        <p className="mt-3 text-sm text-(--muted)">
          The upload token is printed in the server log on first boot (or set{" "}
          <code className="font-mono">COVALLABY_TOKEN</code>).
        </p>
      </Card>
    );
  }

  const orgFilter = owner ?? null;
  const shown = orgFilter ? repos.filter((r) => r.repo.split("/")[0] === orgFilter) : repos;
  const shownUploads = orgFilter
    ? (feed?.uploads ?? []).filter((u) => u.repo.split("/")[0] === orgFilter)
    : (feed?.uploads ?? []);

  if (orgFilter && shown.length === 0) {
    return (
      <p className="text-sm text-(--muted)">
        No repositories under <span className="font-mono text-(--ink-2)">{orgFilter}</span> yet.{" "}
        <Link to="/" className="text-(--ink-2) hover:underline">
          Show all orgs
        </Link>
      </p>
    );
  }

  const totalCovered = shown.reduce((n, r) => n + r.latest.linesCovered, 0);
  const totalLines = shown.reduce((n, r) => n + r.latest.linesTotal, 0);
  const overall = totalLines === 0 ? null : (totalCovered / totalLines) * 100;
  const worst = [...shown].sort(
    (a, b) => (a.latest.percent ?? 101) - (b.latest.percent ?? 101),
  )[0]!;
  const lastUpload = shownUploads[0];

  return (
    <div>
      {orgFilter && (
        <div className="mb-4 flex items-center gap-3">
          <Link
            to="/"
            className="text-[13px] text-(--muted) transition-colors hover:text-(--ink) hover:underline"
          >
            ← all orgs
          </Link>
          <div className="flex items-center gap-2">
            <OwnerAvatar owner={orgFilter} size={20} />
            <h1 className="text-[15px] font-semibold tracking-tight">{orgFilter}</h1>
            <span className="text-xs text-(--muted)">overview · {shown.length}</span>
          </div>
        </div>
      )}
      <ActivityFeedCard repos={shown} feed={feed} orgFilter={orgFilter} />
      <PortfolioConfidenceCoverage repos={shown} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Tile
          label="Overall coverage"
          value={<span className={inkFor[severity(overall)]}>{formatPercent(overall)}</span>}
          sub={`${totalCovered.toLocaleString()} of ${totalLines.toLocaleString()} lines`}
        />
        <Tile label="Repositories" value={shown.length} />
        <Tile
          label="Needs some love"
          value={
            <Link to={`/r/${worst.repo}`} className="hover:underline">
              <span className={`font-mono text-[17px] ${inkFor[severity(worst.latest.percent)]}`}>
                {shortRepoName(worst.repo)}
              </span>
            </Link>
          }
          sub={`lowest at ${formatPercent(worst.latest.percent)}`}
        />
        <Tile
          label="Last upload"
          value={lastUpload ? ago(lastUpload.createdAt) : "—"}
          sub={lastUpload ? lastUpload.repo : undefined}
        />
      </div>

      {shown.length >= 1 && (
        <div className="mt-4 grid grid-cols-1 gap-4">
          <Card>
            <CardHeader
              title="Risk map"
              description="Coverage vs. codebase size — big and under-tested lands in the danger zone"
            />
            <div className="px-4 pb-4">
              <RiskQuadrant repos={shown} />
            </div>
          </Card>
          {!orgFilter && (
            <Card>
              <CardHeader
                title="Coverage debt"
                description="Covered vs. total lines across every repository"
              />
              <div className="px-2 pb-3">
                {trends ? (
                  <CoverageDebt trends={trends} />
                ) : (
                  <Skeleton className="mx-3 my-6 h-40" />
                )}
              </div>
            </Card>
          )}
        </div>
      )}

      {groupReposByOwner(shown).map((group) => (
        <section key={group.owner} className="mt-6">
          <div className="mb-3 flex items-center gap-2.5">
            <Link
              to={`/o/${encodeURIComponent(group.owner)}`}
              className="flex items-center gap-2.5 transition-opacity hover:opacity-75"
              title={`${group.owner} overview`}
            >
              <OwnerAvatar owner={group.owner} size={22} />
              <h2 className="text-[14px] font-semibold tracking-tight">{group.owner}</h2>
            </Link>
            <span className="text-xs text-(--muted)">
              {group.repos.length} {group.repos.length === 1 ? "repo" : "repos"} ·{" "}
              <span className={inkFor[severity(group.percent)]}>
                {formatPercent(group.percent)}
              </span>
            </span>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {[...group.repos]
              .sort((a, b) => momentum(b) - momentum(a))
              .map((r) => (
                <RepoCard key={r.repo} r={r} />
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}
