import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { type RepoHistory, api, formatPercent, severity } from "../api.js";
import { HistoryChart } from "../components/charts.js";
import {
  Card,
  DeltaChip,
  Meter,
  Pct,
  SectionTitle,
  Stat,
  Td,
  Th,
  inkFor,
} from "../components/ui.js";

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function Repo() {
  const { owner, name } = useParams();
  const repo = `${owner}/${name}`;
  const [params] = useSearchParams();
  const branch = params.get("branch") ?? undefined;
  const [data, setData] = useState<RepoHistory | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .history(repo, branch)
      .then(setData)
      .catch((e) => setError(String(e)));
  }, [repo, branch]);

  if (error) return <p className="text-sm text-(--bad)">{error}</p>;
  if (!data) return null;

  const latest = data.history[0];
  const previous = data.history[1];
  const chartPoints = [...data.history]
    .reverse()
    .map((u) => ({ percent: u.percent, label: u.commit.slice(0, 7) }));

  return (
    <div>
      {latest && (
        <div className="mb-6 flex flex-wrap items-end justify-between gap-6">
          <div>
            <div className="text-xs text-(--muted)">
              Coverage on <span className="font-mono">{data.branch}</span>
            </div>
            <div
              className={`mt-1 flex items-center gap-3 text-[52px] leading-none font-semibold tracking-tighter ${inkFor[severity(latest.percent)]}`}
            >
              {formatPercent(latest.percent)}
              <DeltaChip current={latest.percent} previous={previous?.percent} />
            </div>
            <Meter percent={latest.percent} className="mt-4 w-72" />
          </div>
          <div className="flex flex-wrap gap-8 pb-1.5">
            <Stat
              value={
                <>
                  {latest.linesCovered.toLocaleString()}
                  <span className="font-normal text-(--muted)">
                    /{latest.linesTotal.toLocaleString()}
                  </span>
                </>
              }
              label="lines covered"
            />
            <Stat value={latest.files} label="files" />
            <Stat value={data.history.length} label="uploads" />
            <Stat
              value={
                <span className="pt-1 font-mono text-[15px]">{latest.commit.slice(0, 7)}</span>
              }
              label="latest commit"
            />
          </div>
        </div>
      )}

      <div className="mb-5 flex flex-wrap gap-2">
        {data.branches.slice(0, 8).map((b) => (
          <Link
            key={b}
            to={`/r/${repo}?branch=${encodeURIComponent(b)}`}
            className={`rounded-full border px-3.5 py-1 text-[13px] transition-colors ${
              b === data.branch
                ? "border-(--ink) bg-(--ink) font-medium text-(--page)"
                : "border-(--border) bg-(--surface) text-(--ink-2) hover:border-(--muted)"
            }`}
          >
            {b}
          </Link>
        ))}
      </div>

      <SectionTitle>History</SectionTitle>
      <Card className="px-3 pt-4 pb-2">
        <HistoryChart points={chartPoints} />
      </Card>

      <Card className="mt-4 px-1 pt-3 pb-1">
        <table className="w-full text-[13.5px]">
          <thead>
            <tr>
              <Th>Commit</Th>
              <Th>When</Th>
              <Th right>Lines</Th>
              <Th right>Δ</Th>
              <Th right>Coverage</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {data.history.map((u, i) => (
              <tr key={u.id} className="transition-colors hover:bg-(--surface-2)">
                <Td>
                  <Link
                    className="font-mono text-[12.5px] hover:underline"
                    to={`/r/${repo}/u/${u.id}`}
                  >
                    {u.commit.slice(0, 10)}
                  </Link>
                  {u.pr ? <span className="ml-1.5 text-(--muted)">#{u.pr}</span> : null}
                </Td>
                <Td className="text-(--muted)">{when(u.createdAt)}</Td>
                <Td className="text-right font-mono text-[12.5px] text-(--muted) tabular-nums">
                  {u.linesCovered.toLocaleString()}/{u.linesTotal.toLocaleString()}
                </Td>
                <Td className="text-right">
                  <DeltaChip current={u.percent} previous={data.history[i + 1]?.percent} />
                </Td>
                <Td className="text-right">
                  <Pct percent={u.percent} />
                </Td>
                <Td className="w-28">
                  <Meter percent={u.percent} />
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
