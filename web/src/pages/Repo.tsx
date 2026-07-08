import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { type RepoHistory, type UploadDetail, api, formatPercent, severity } from "../api.js";
import { HistoryChart } from "../components/charts.js";
import { PageSkeleton } from "../components/skeleton.js";
import {
  Card,
  CardFooter,
  CardHeader,
  DeltaChip,
  Meter,
  Pct,
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

function mood(percent: number | null, delta: number | null): string {
  if (percent === null) return "Nothing coverable yet.";
  if (delta !== null && delta >= 1) return "Nice jump! Coverage improved 🎉";
  if (percent >= 90) return "You're covered.";
  if (percent >= 75) return "Almost covered.";
  return "This one needs some love.";
}

const RANGES = [
  { key: "10", label: "Last 10", n: 10 },
  { key: "30", label: "Last 30", n: 30 },
  { key: "all", label: "All", n: Number.POSITIVE_INFINITY },
] as const;

function StatCard({
  label,
  value,
  footer,
}: {
  label: string;
  value: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <Card>
      <div className="px-5 pt-4 pb-3">
        <div className="text-xs text-(--muted)">{label}</div>
        <div className="mt-1.5 text-[26px] leading-none font-semibold tracking-tight">{value}</div>
      </div>
      <CardFooter>{footer}</CardFooter>
    </Card>
  );
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
    <Card>
      <CardHeader title="Badge" description="Live from the latest main upload" />
      <div className="px-5 pb-4">
        <img src={`/badge/${repo}.svg`} alt="coverage badge" className="mb-3 h-5" />
        <button
          type="button"
          onClick={copy}
          className="flex w-full items-center justify-between gap-2 rounded-lg border border-(--hairline) bg-(--surface-2) px-3 py-2 text-left font-mono text-[11px] text-(--ink-2) transition-colors hover:border-(--muted)"
        >
          <span className="min-w-0 truncate">{markdown}</span>
          {copied ? (
            <Check size={13} className="shrink-0 text-(--good)" />
          ) : (
            <Copy size={13} className="shrink-0" />
          )}
        </button>
      </div>
      <CardFooter>
        {copied ? "Copied! Paste it into your README. 🎉" : "Click to copy the README markdown."}
      </CardFooter>
    </Card>
  );
}

function NeedsLove({ latestId }: { latestId: number }) {
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
    <Card>
      <CardHeader title="Needs some love" description="Lowest directories, latest upload" />
      <div className="space-y-3 px-5 pb-4">
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
      <CardFooter>
        <Link to={`/r/${detail.row.repo}/u/${detail.row.id}`} className="hover:text-(--ink)">
          Full breakdown →
        </Link>
      </CardFooter>
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
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("30");
  const navigate = useNavigate();

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
  const rangeN = RANGES.find((r) => r.key === range)!.n;
  const chartPoints = [...data.history]
    .slice(0, rangeN === Number.POSITIVE_INFINITY ? undefined : rangeN)
    .reverse()
    .map((u) => ({
      percent: u.percent,
      label: u.commit.slice(0, 7),
      sublabel: when(u.createdAt),
    }));
  const delta =
    latest?.percent != null && previous?.percent != null ? latest.percent - previous.percent : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-mono text-lg font-semibold tracking-tight">{repo}</h1>
          <p className="text-[13px] text-(--muted)">
            {latest ? mood(latest.percent, delta) : "No uploads yet."}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {data.branches.slice(0, 6).map((b) => (
            <Link
              key={b}
              to={`/r/${repo}?branch=${encodeURIComponent(b)}`}
              className={`rounded-lg border px-3 py-1 text-[12.5px] transition-colors ${
                b === data.branch
                  ? "border-(--accent) bg-(--accent-wash) font-medium text-(--ink)"
                  : "border-(--border) bg-(--surface) text-(--ink-2) hover:border-(--muted)"
              }`}
            >
              {b}
            </Link>
          ))}
        </div>
      </div>

      {latest && (
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
      )}

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
            title="Uploads"
            description={`${data.history.length} on ${data.branch}, newest first`}
          />
          <div className="px-1 pb-1">
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
                  <tr
                    key={u.id}
                    onClick={() => navigate(`/r/${repo}/u/${u.id}`)}
                    className="cursor-pointer transition-colors hover:bg-(--surface-2)"
                  >
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
                    <Td className="w-24">
                      <Meter percent={u.percent} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="space-y-4">
          {latest && <NeedsLove latestId={latest.id} />}
          <BadgeCard repo={repo} />
        </div>
      </div>
    </div>
  );
}
