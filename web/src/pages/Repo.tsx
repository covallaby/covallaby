import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { type RepoHistory, type UploadDetail, api, formatPercent, severity } from "../api.js";
import { HistoryChart } from "../components/charts.js";
import { PageSkeleton } from "../components/skeleton.js";
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

function BadgeCard({ repo }: { repo: string }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/badge/${repo}.svg`;
  const markdown = `![coverage](${url})`;
  const copy = async () => {
    await navigator.clipboard.writeText(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <Card className="p-4">
      <div className="mb-2.5 text-xs font-semibold tracking-wide text-(--muted) uppercase">
        Badge
      </div>
      <img src={`/badge/${repo}.svg`} alt="coverage badge" className="mb-3 h-5" />
      <button
        type="button"
        onClick={copy}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-(--hairline) bg-(--surface-2) px-3 py-2 text-left font-mono text-[11px] break-all text-(--ink-2) transition-colors hover:border-(--muted)"
      >
        <span className="min-w-0 truncate">{markdown}</span>
        {copied ? (
          <Check size={13} className="shrink-0 text-(--good)" />
        ) : (
          <Copy size={13} className="shrink-0" />
        )}
      </button>
      <p className="mt-2 text-[11.5px] text-(--muted)">
        {copied ? "Copied! Paste it into your README." : "Click to copy the README markdown."}
      </p>
    </Card>
  );
}

function NeedsAttention({ latestId }: { latestId: number }) {
  const [detail, setDetail] = useState<UploadDetail | null>(null);
  useEffect(() => {
    api
      .upload(String(latestId))
      .then(setDetail)
      .catch(() => setDetail(null));
  }, [latestId]);
  if (!detail) return null;
  const worst = detail.directories.filter((d) => (d.percent ?? 100) < 100).slice(0, 5);
  if (worst.length === 0) return null;
  return (
    <Card className="p-4">
      <div className="mb-3 text-xs font-semibold tracking-wide text-(--muted) uppercase">
        Needs attention
      </div>
      <div className="space-y-3">
        {worst.map((d) => (
          <div key={d.path}>
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate font-mono text-[12px] text-(--ink-2)">
                {d.path}/
              </span>
              <span
                className={`text-[12px] font-semibold tabular-nums ${inkFor[severity(d.percent)]}`}
              >
                {formatPercent(d.percent)}
              </span>
            </div>
            <Meter percent={d.percent} />
          </div>
        ))}
      </div>
      <Link
        to={`/r/${detail.row.repo}/u/${detail.row.id}`}
        className="mt-3 block text-[12px] text-(--ink-2) hover:underline"
      >
        Full breakdown →
      </Link>
    </Card>
  );
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
  if (!data) return <PageSkeleton />;

  const latest = data.history[0];
  const previous = data.history[1];
  const chartPoints = [...data.history].reverse().map((u) => ({
    percent: u.percent,
    label: u.commit.slice(0, 7),
    sublabel: when(u.createdAt),
  }));

  return (
    <div>
      {latest && (
        <div className="mb-7 flex flex-wrap items-end justify-between gap-6">
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

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div>
          <div className="mb-3 flex items-center justify-between gap-4">
            <h2 className="text-xs font-semibold tracking-wide text-(--muted) uppercase">
              History
            </h2>
            <div className="flex flex-wrap gap-1.5">
              {data.branches.slice(0, 6).map((b) => (
                <Link
                  key={b}
                  to={`/r/${repo}?branch=${encodeURIComponent(b)}`}
                  className={`rounded-full border px-3 py-0.5 text-[12.5px] transition-colors ${
                    b === data.branch
                      ? "border-(--ink) bg-(--ink) font-medium text-(--page)"
                      : "border-(--border) bg-(--surface) text-(--ink-2) hover:border-(--muted)"
                  }`}
                >
                  {b}
                </Link>
              ))}
            </div>
          </div>
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

        <div className="space-y-4">
          {latest && <NeedsAttention latestId={latest.id} />}
          <BadgeCard repo={repo} />
        </div>
      </div>
    </div>
  );
}
