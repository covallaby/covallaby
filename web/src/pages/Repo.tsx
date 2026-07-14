import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Link,
  Outlet,
  useNavigate,
  useOutletContext,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  type RepoHistory,
  type UploadDetail,
  type UploadRow,
  api,
  formatPercent,
  severity,
} from "../api.js";
import { RepoTabs } from "../components/repo-tabs.js";
import { ScopePicker } from "../components/scope-picker.js";
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

/** Shared context for every repo sub-view (Summary, Uploads, Pull requests, Policy). */
export interface RepoContext {
  repo: string;
  data: RepoHistory;
}
export function useRepo(): RepoContext {
  return useOutletContext<RepoContext>();
}

export function when(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export const RANGES = [
  { key: "10", label: "Last 10", n: 10 },
  { key: "30", label: "Last 30", n: 30 },
  { key: "all", label: "All", n: Number.POSITIVE_INFINITY },
] as const;

export function StatCard({
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

export function BadgeCard({ repo }: { repo: string }) {
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

export function NeedsLove({ latestId }: { latestId: number }) {
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

/** The uploads table, shared by the Summary preview (limit=5) and the Uploads view. */
export function UploadsTable({
  repo,
  history,
  limit,
}: {
  repo: string;
  history: UploadRow[];
  limit?: number;
}) {
  const navigate = useNavigate();
  const rows = limit ? history.slice(0, limit) : history;
  return (
    <div className="max-w-full overflow-x-auto overscroll-x-contain" data-mobile-scroll-region>
      <table className="w-full min-w-[680px] text-[13.5px]">
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
          {rows.map((u, i) => (
            // biome-ignore lint/a11y/useKeyWithClickEvents: the commit Link is the keyboard path; row onClick is a mouse convenience
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
                <DeltaChip current={u.percent} previous={history[i + 1]?.percent} />
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
  );
}

export function RepoHeader({ repo, data }: { repo: string; data: RepoHistory }) {
  const [, setParams] = useSearchParams();
  const navigate = useNavigate();
  const latest = data.history[0];
  const setBranch = (b: string) =>
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set("branch", b);
      return p;
    });
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="font-mono text-lg font-semibold tracking-tight">{repo}</h1>
        <p className="text-[13px] text-(--muted)">
          {latest
            ? `${formatPercent(latest.percent)} · ${latest.files} files · ${latest.commit.slice(0, 7)}`
            : "No uploads yet."}
        </p>
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <ScopePicker
          label="Branch or pull request"
          current={data.branch}
          branches={data.branches}
          onSelectBranch={setBranch}
          loadPullRequests={() => api.prs(repo).then((d) => d.prs)}
          onSelectPullRequest={(pr) => navigate(`/r/${repo}/pr/${pr}`)}
          className="flex-1 sm:w-64 sm:flex-none"
        />
        <Link
          to={`/r/${repo}/compare?head=${encodeURIComponent(data.branch)}&base=main`}
          className="shrink-0 rounded-lg border border-(--border) bg-(--surface) px-3 py-2 text-xs font-medium text-(--ink-2) transition-colors hover:border-(--muted) hover:text-(--ink)"
        >
          Compare
        </Link>
      </div>
    </div>
  );
}

/** The repo section: shared header + the active sub-view via <Outlet>. */
export function RepoLayout() {
  const { owner, name } = useParams();
  const repo = `${owner}/${name}`;
  const [params] = useSearchParams();
  const branch = params.get("branch") ?? undefined;
  const [data, setData] = useState<RepoHistory | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    api
      .history(repo, branch)
      .then(setData)
      .catch((e) => setError(String(e)));
  }, [repo, branch]);

  if (error) return <p className="text-sm text-(--bad)">{error}</p>;
  if (!data) return <PageSkeleton />;

  return (
    <div className="space-y-4">
      <RepoHeader repo={repo} data={data} />
      <RepoTabs repo={repo} />
      <Outlet context={{ repo, data } satisfies RepoContext} />
    </div>
  );
}
