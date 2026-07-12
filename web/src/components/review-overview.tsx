import {
  AlertTriangle,
  ArrowRight,
  type BookOpen,
  CheckCircle2,
  CirclePlay,
  GitPullRequest,
  Images,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  type RepoOverview,
  type ReviewSignals,
  type StorybookPreview,
  type TestRun,
  api,
  formatPercent,
  shortRepoName,
} from "../api.js";
import { Card, CardHeader } from "./ui.js";

function useVisualState(repo?: string) {
  const [state, setState] = useState<ReviewSignals[] | null>(null);
  useEffect(() => {
    let active = true;
    api
      .reviewSignals(repo)
      .then((result) => {
        if (active) setState(result.repositories);
      })
      .catch(() => {
        if (active) setState([]);
      });
    return () => {
      active = false;
    };
  }, [repo]);
  return state;
}

const relativeTime = (iso: string) => {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
};

type ReviewItem = {
  id: string;
  priority: number;
  createdAt: string;
  repo: string;
  title: string;
  detail: string;
  href: string;
  action: string;
  tone: "bad" | "review";
  icon: typeof AlertTriangle;
};

export function PortfolioReviewQueue({ repos }: { repos: RepoOverview[] }) {
  const visual = useVisualState();
  const items = useMemo(() => {
    if (!visual) return null;
    const review: ReviewItem[] = [];
    for (const repo of repos) {
      const state = visual.find((entry) => entry.repo === repo.repo);
      const run = state?.runs[0];
      const preview = state?.previews[0];
      const previous = repo.trend.at(-2);
      const current = repo.latest.percent;
      if (run?.testsFailed || run?.status === "failed") {
        review.push({
          id: `run-${run.id}`,
          priority: 0,
          createdAt: run.createdAt,
          repo: repo.repo,
          title: `${run.testsFailed || 1} browser ${run.testsFailed === 1 ? "test needs" : "tests need"} attention`,
          detail: run.pr ? `PR #${run.pr} · ${run.branch}` : run.branch,
          href: `/r/${repo.repo}/test-runs/${run.id}`,
          action: "Inspect run",
          tone: "bad",
          icon: AlertTriangle,
        });
      } else if (run?.pr && run.status === "complete") {
        review.push({
          id: `run-${run.id}`,
          priority: 2,
          createdAt: run.createdAt,
          repo: repo.repo,
          title: `${run.testsPassed} browser tests are ready to watch`,
          detail: `PR #${run.pr} · recorded journeys`,
          href: `/r/${repo.repo}/test-runs/${run.id}`,
          action: "Watch run",
          tone: "review",
          icon: CirclePlay,
        });
      }
      if (preview?.pr && preview.status === "complete") {
        const count = preview.imageCount ?? 0;
        review.push({
          id: `preview-${preview.id}`,
          priority: 1,
          createdAt: preview.createdAt,
          repo: repo.repo,
          title:
            count > 0
              ? `${count} component captures are ready to review`
              : "Component captures are ready to review",
          detail: `PR #${preview.pr} · ${preview.branch}`,
          href: `/r/${repo.repo}/storybook-previews/${preview.id}`,
          action: "Review captures",
          tone: "review",
          icon: Images,
        });
      }
      if (current !== null && previous !== null && previous !== undefined && current < previous) {
        review.push({
          id: `coverage-${repo.latest.id}`,
          priority: 1,
          createdAt: repo.latest.createdAt,
          repo: repo.repo,
          title: `Coverage dropped ${(previous - current).toFixed(1)} points`,
          detail: `${formatPercent(current)} on ${repo.latest.branch}`,
          href: `/r/${repo.repo}/u/${repo.latest.id}`,
          action: "Inspect change",
          tone: "review",
          icon: AlertTriangle,
        });
      }
    }
    return review
      .sort((a, b) => a.priority - b.priority || Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, 6);
  }, [repos, visual]);

  return (
    <Card className="mb-4 overflow-hidden">
      <CardHeader
        title="Needs attention"
        description="The newest changes worth reviewing across your repositories"
      />
      {!items ? (
        <p className="px-5 pb-5 text-sm text-(--muted)">Checking the latest CI activity…</p>
      ) : items.length === 0 ? (
        <div className="flex items-center gap-3 px-5 pb-5 text-sm text-(--ink-2)">
          <CheckCircle2 size={18} className="text-(--good)" /> Nothing needs review right now.
        </div>
      ) : (
        <div className="divide-y divide-(--hairline)">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.id}
                to={item.href}
                className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-(--surface-2) sm:px-5"
              >
                <span
                  className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${
                    item.tone === "bad"
                      ? "bg-(--bad)/10 text-(--bad)"
                      : "bg-(--accent-wash) text-(--accent)"
                  }`}
                >
                  <Icon size={17} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="font-mono text-xs text-(--muted)">
                      {shortRepoName(item.repo)}
                    </span>
                    <span className="text-sm font-medium">{item.title}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-(--muted)">
                    {item.detail} · {relativeTime(item.createdAt)}
                  </span>
                </span>
                <span className="hidden shrink-0 items-center gap-1 text-xs font-medium text-(--ink-2) group-hover:text-(--ink) sm:flex">
                  {item.action} <ArrowRight size={13} />
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </Card>
  );
}

export function PortfolioConfidenceCoverage({ repos }: { repos: RepoOverview[] }) {
  const visual = useVisualState();
  if (!visual) return null;
  const states = repos.map((repo) => visual.find((entry) => entry.repo === repo.repo));
  const latestRuns = states.map((state) => state?.runs[0]).filter(Boolean) as TestRun[];
  const latestPreviews = states
    .map((state) => state?.previews[0])
    .filter(Boolean) as StorybookPreview[];
  const journeys = latestRuns.reduce(
    (total, run) => total + run.testsPassed + run.testsFailed + run.testsSkipped,
    0,
  );
  const captures = latestPreviews.reduce((total, preview) => total + (preview.imageCount ?? 0), 0);
  return (
    <Card className="mb-4 overflow-hidden">
      <CardHeader
        title="Confidence coverage"
        description="Three independent signals—never rolled into a misleading combined score"
      />
      <div className="grid divide-y divide-(--hairline) sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <div className="p-4 sm:p-5">
          <div className="text-xs font-medium text-(--muted)">Code coverage</div>
          <div className="mt-2 text-2xl font-semibold">
            {repos.length}/{repos.length}
          </div>
          <div className="mt-1 text-xs text-(--muted)">repositories reporting line coverage</div>
        </div>
        <div className="p-4 sm:p-5">
          <div className="text-xs font-medium text-(--muted)">Journey execution</div>
          <div className="mt-2 text-2xl font-semibold">{journeys}</div>
          <div className="mt-1 text-xs text-(--muted)">
            tests across {latestRuns.length}/{repos.length} repositories
          </div>
        </div>
        <div className="p-4 sm:p-5">
          <div className="text-xs font-medium text-(--muted)">Component coverage</div>
          <div className="mt-2 text-2xl font-semibold">{captures}</div>
          <div className="mt-1 text-xs text-(--muted)">
            states across {latestPreviews.length}/{repos.length} repositories
          </div>
        </div>
      </div>
    </Card>
  );
}

function SnapshotCell({
  icon: Icon,
  label,
  value,
  detail,
  href,
}: {
  icon: typeof BookOpen;
  label: string;
  value: string;
  detail: string;
  href: string;
}) {
  return (
    <Link to={href} className="group min-w-0 p-4 transition-colors hover:bg-(--surface-2) sm:p-5">
      <span className="flex items-center gap-2 text-xs font-medium text-(--muted)">
        <Icon size={14} /> {label}
      </span>
      <span className="mt-2 block truncate text-[15px] font-semibold group-hover:underline">
        {value}
      </span>
      <span className="mt-1 block truncate text-xs text-(--muted)">{detail}</span>
    </Link>
  );
}

export function RepositoryLatestSnapshot({ repo }: { repo: RepoOverview }) {
  const visual = useVisualState(repo.repo);
  const run = visual?.[0]?.runs[0];
  const preview = visual?.[0]?.previews[0];
  const captureCount = preview?.imageCount ?? 0;
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Latest checks"
        description="The newest signal reported by each CI surface"
      />
      <div className="grid divide-y divide-(--hairline) sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <SnapshotCell
          icon={CheckCircle2}
          label="Code coverage"
          value={formatPercent(repo.latest.percent)}
          detail={`${repo.latest.linesCovered.toLocaleString()} of ${repo.latest.linesTotal.toLocaleString()} lines`}
          href={`/r/${repo.repo}/u/${repo.latest.id}`}
        />
        <SnapshotCell
          icon={CirclePlay}
          label="Journey execution"
          value={
            run
              ? run.testsFailed
                ? `${run.testsFailed} failed`
                : `${run.testsPassed} passed`
              : "Not reported"
          }
          detail={
            run
              ? `${run.pr ? `PR #${run.pr} · ` : ""}${relativeTime(run.createdAt)}`
              : "Add Playwright results in CI"
          }
          href={run ? `/r/${repo.repo}/test-runs/${run.id}` : `/r/${repo.repo}/playbacks`}
        />
        <SnapshotCell
          icon={Images}
          label="Component coverage"
          value={
            preview
              ? captureCount > 0
                ? `${captureCount} states captured`
                : "Ready to review"
              : "Not reported"
          }
          detail={
            preview
              ? `${preview.pr ? `PR #${preview.pr} · ` : ""}${relativeTime(preview.createdAt)}`
              : "Publish Storybook captures in CI"
          }
          href={
            preview
              ? `/r/${repo.repo}/storybook-previews/${preview.id}`
              : `/r/${repo.repo}/storybook-previews`
          }
        />
      </div>
    </Card>
  );
}
