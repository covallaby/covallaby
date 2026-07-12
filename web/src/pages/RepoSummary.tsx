import { useState } from "react";
import { Link } from "react-router-dom";
import { formatPercent, severity } from "../api.js";
import { HistoryChart } from "../components/charts.js";
import { RepositoryLatestSnapshot } from "../components/review-overview.js";
import { Card, CardHeader, DeltaChip, inkFor } from "../components/ui.js";
import { BadgeCard, NeedsLove, RANGES, StatCard, UploadsTable, useRepo, when } from "./Repo.js";

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
      <RepositoryLatestSnapshot
        repo={{
          repo,
          latest,
          trend: [...data.history].reverse().map((upload) => upload.percent),
        }}
      />
      <p className="px-1 text-xs text-(--muted)">
        These signals measure different things: code lines exercised, browser journeys executed, and
        component states captured. Covallaby keeps them separate instead of inventing one confidence
        percentage.
      </p>
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
        <Card>
          <CardHeader
            title="Recent uploads"
            description={`Newest on ${data.branch}`}
            action={
              data.history.length > 5 ? (
                <Link
                  to={`/r/${repo}/uploads`}
                  className="text-[12.5px] text-(--muted) hover:text-(--ink)"
                >
                  View all {data.history.length} →
                </Link>
              ) : undefined
            }
          />
          <div className="px-1 pb-1">
            <UploadsTable repo={repo} history={data.history} limit={5} />
          </div>
        </Card>

        <div className="space-y-4">
          <NeedsLove latestId={latest.id} />
          <BadgeCard repo={repo} />
        </div>
      </div>
    </div>
  );
}
