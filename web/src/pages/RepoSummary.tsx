import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { type RepoActivityFeed, api, formatPercent, severity } from "../api.js";
import { FeedRow } from "../components/activity-feed.js";
import { HistoryChart } from "../components/charts.js";
import { RepositoryCommitStatus } from "../components/review-overview.js";
import { Card, CardHeader, DeltaChip, inkFor } from "../components/ui.js";
import { buildFeed } from "../feed.js";
import { BadgeCard, NeedsLove, RANGES, StatCard, useRepo, when } from "./Repo.js";

/**
 * A five-row taste of the repo's unified Activity feed — the same rows the
 * Activity tab renders (all three signals, no repo badge), without the chips
 * or quiet-collapse. "View all →" hands off to the full tab.
 */
function RecentActivityCard({ repo }: { repo: string }) {
  const [params] = useSearchParams();
  const branch = params.get("branch") ?? undefined;
  const [feed, setFeed] = useState<RepoActivityFeed | null>(null);
  useEffect(() => {
    setFeed(null);
    api
      .repoActivity(repo, branch)
      .then(setFeed)
      .catch(() => setFeed({ repo, branch: branch ?? null, items: [], runsSupported: true }));
  }, [repo, branch]);
  const entries = feed ? buildFeed(feed.items).slice(0, 5) : null;
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Recent activity"
        description={branch ? `Newest on ${branch}` : "Newest across every branch"}
        action={
          <Link
            to={`/r/${repo}/activity`}
            className="text-[12.5px] text-(--muted) hover:text-(--ink)"
          >
            View all →
          </Link>
        }
      />
      {!entries ? (
        <p className="px-5 pb-4 text-sm text-(--muted)">Fetching the latest activity…</p>
      ) : entries.length === 0 ? (
        <p className="px-5 pb-4 text-sm text-(--muted)">
          Quiet in here — activity from CI will hop in soon. 🦘
        </p>
      ) : (
        <div className="divide-y divide-(--hairline) border-t border-(--hairline)">
          {entries.map((entry) => (
            <FeedRow key={entry.key} entry={entry} />
          ))}
        </div>
      )}
    </Card>
  );
}

export function Summary() {
  const { repo, data } = useRepo();
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("30");

  const latest = data.history[0];
  const previous = data.history[1];
  const rangeN = RANGES.find((r) => r.key === range)!.n;
  const chartPoints = [...data.history]
    .slice(0, rangeN === Number.POSITIVE_INFINITY ? undefined : rangeN)
    .reverse()
    .map((u) => ({
      percent: u.percent,
      label: u.commit.slice(0, 7),
      sublabel: when(u.createdAt),
      t: new Date(u.createdAt).getTime(),
    }));

  if (!latest) {
    return <p className="text-sm text-(--muted)">No uploads on this branch yet. 🦘</p>;
  }

  return (
    <div className="space-y-4">
      <RepositoryCommitStatus repo={repo} uploads={data.history} />
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard
          label="Coverage"
          value={
            <span className={inkFor[severity(latest.percent)]}>
              {formatPercent(latest.percent)}
            </span>
          }
          footer={
            <span className="flex items-center gap-2">
              <DeltaChip current={latest.percent} previous={previous?.percent} />
              vs previous upload
            </span>
          }
        />
        <StatCard
          label="Lines covered"
          value={
            <>
              {latest.linesCovered.toLocaleString()}
              <span className="text-[15px] font-normal text-(--muted)">
                /{latest.linesTotal.toLocaleString()}
              </span>
            </>
          }
          footer={`${(latest.linesTotal - latest.linesCovered).toLocaleString()} lines still uncovered`}
        />
        <StatCard label="Files" value={latest.files} footer="tracked in the latest upload" />
        <StatCard
          label="Latest commit"
          value={<span className="font-mono text-[19px]">{latest.commit.slice(0, 7)}</span>}
          footer={`uploaded ${when(latest.createdAt)}`}
        />
      </div>

      <Card>
        <CardHeader
          title="Coverage history"
          description={`Uploads on ${data.branch}`}
          action={
            <div className="flex rounded-lg border border-(--hairline) p-0.5">
              {RANGES.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => setRange(r.key)}
                  className={`rounded-md px-2.5 py-1 text-[12px] transition-colors ${
                    range === r.key
                      ? "bg-(--surface-2) font-medium text-(--ink)"
                      : "text-(--muted) hover:text-(--ink)"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          }
        />
        <div className="px-2 pb-2">
          <HistoryChart points={chartPoints} />
        </div>
      </Card>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_290px]">
        <RecentActivityCard repo={repo} />

        <div className="space-y-4">
          <NeedsLove latestId={latest.id} />
          <BadgeCard repo={repo} />
        </div>
      </div>
    </div>
  );
}
