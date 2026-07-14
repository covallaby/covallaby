import { AlertTriangle, ArrowRight, type BookOpen, CheckCircle2, ChevronDown } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  type RepoOverview,
  type ReviewSignals,
  api,
  formatPercent,
  shortRepoName,
} from "../api.js";
import { buildCommitChecks } from "../checks.js";
import {
  InfoHint,
  SIGNALS,
  STATES_HINT,
  type SignalBreakdown,
  type SignalDefinition,
  type SignalKey,
  isSignalKey,
  signalByKey,
  summarizeSignals,
} from "./confidence-signals.js";
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
      const check = buildCommitChecks([repo.latest], state?.runs ?? [], state?.previews ?? [])[0];
      const run = check?.journey;
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
      } else if (check?.components?.reviewState === "rejected") {
        const preview = check.components;
        review.push({
          id: `preview-${preview.id}`,
          priority: 0,
          createdAt: preview.createdAt,
          repo: repo.repo,
          title: "Visual changes were rejected",
          detail: preview.pr ? `PR #${preview.pr} · ${preview.branch}` : preview.branch,
          href: `/r/${repo.repo}/storybook-previews/${preview.id}`,
          action: "Review captures",
          tone: "bad",
          icon: AlertTriangle,
        });
      } else if (check?.status === "partial" && check.commit === repo.latest.commit) {
        review.push({
          id: `commit-${check.commit}`,
          priority: 1,
          createdAt: check.createdAt,
          repo: repo.repo,
          title: `Commit is missing ${check.missing.join(" and ")}`,
          detail: `${check.pr ? `PR #${check.pr} · ` : ""}${check.commit.slice(0, 7)}`,
          href: `/r/${repo.repo}/commits`,
          action: "Review status",
          tone: "review",
          icon: AlertTriangle,
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

export function RepositoryCommitStatus({
  repo,
  uploads,
}: { repo: string; uploads: RepoOverview["latest"][] }) {
  const visual = useVisualState(repo);
  const checks = buildCommitChecks(uploads, visual?.[0]?.runs ?? [], visual?.[0]?.previews ?? []);
  const check = checks[0];
  if (!visual) return <Card className="p-5 text-sm text-(--muted)">Matching commit evidence…</Card>;
  if (!check) return null;
  const status =
    check.status === "ready" ? "Ready" : check.status === "failed" ? "Blocked" : "Incomplete";
  const statusClass =
    check.status === "ready"
      ? "text-(--good)"
      : check.status === "failed"
        ? "text-(--bad)"
        : "text-(--warn)";
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-(--hairline) px-4 py-4 sm:px-5">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-lg font-semibold ${statusClass}`}>{status}</span>
            <span className="font-mono text-xs text-(--muted)">{check.commit.slice(0, 10)}</span>
            {check.pr ? <span className="text-xs text-(--muted)">PR #{check.pr}</span> : null}
          </div>
          <p className="mt-1 text-xs text-(--muted)">
            One commit, three independent signals (Code · Journeys · Components) matched by SHA
          </p>
        </div>
        <Link
          to={`/r/${repo}/commits`}
          className="text-xs font-medium text-(--ink-2) hover:underline"
        >
          All commits →
        </Link>
      </div>
      <div className="grid divide-y divide-(--hairline) sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <SnapshotCell
          icon={signalByKey.code.icon}
          label={signalByKey.code.label}
          info={signalByKey.code.definition}
          value={check.coverage ? formatPercent(check.coverage.percent) : "Missing"}
          detail={
            check.coverage
              ? `${check.coverage.linesCovered.toLocaleString()} of ${check.coverage.linesTotal.toLocaleString()} lines`
              : "No coverage for this SHA"
          }
          href={check.coverage ? `/r/${repo}/u/${check.coverage.id}` : `/r/${repo}/uploads`}
        />
        <SnapshotCell
          icon={signalByKey.journeys.icon}
          label={signalByKey.journeys.label}
          info={signalByKey.journeys.definition}
          value={
            check.journey
              ? `${check.journey.testsPassed} passed${check.journey.testsFailed ? ` · ${check.journey.testsFailed} failed` : ""}`
              : "Missing"
          }
          detail={check.journey ? "Recorded browser evidence" : "No Playwright run for this SHA"}
          href={check.journey ? `/r/${repo}/test-runs/${check.journey.id}` : `/r/${repo}/playbacks`}
        />
        <SnapshotCell
          icon={signalByKey.components.icon}
          label={signalByKey.components.label}
          info={`${signalByKey.components.definition} ${STATES_HINT}`}
          value={check.components ? `${check.components.imageCount ?? 0} states` : "Missing"}
          detail={
            check.components
              ? check.components.reviewState === "rejected"
                ? "Visual changes rejected in review"
                : "Rendered states captured from Storybook"
              : "No component captures for this SHA"
          }
          href={
            check.components
              ? `/r/${repo}/storybook-previews/${check.components.id}`
              : `/r/${repo}/storybook-previews`
          }
        />
      </div>
    </Card>
  );
}

export function PortfolioConfidenceCoverage({ repos }: { repos: RepoOverview[] }) {
  const visual = useVisualState();
  const [params, setParams] = useSearchParams();
  if (!visual) return null;
  const summary = summarizeSignals(repos, visual);
  const rawSignal = params.get("signal");
  const selected: SignalKey | null = isSignalKey(rawSignal) ? rawSignal : null;
  const toggle = (key: SignalKey) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (selected === key) next.delete("signal");
        else next.set("signal", key);
        return next;
      },
      { replace: true },
    );
  };
  const headline: Record<SignalKey, { value: string; sub: string }> = {
    code: {
      value: `${summary.breakdown.code.reporting.length}/${repos.length}`,
      sub: "repositories reporting line coverage",
    },
    journeys: {
      value: summary.journeyTests.toLocaleString(),
      sub: `tests across ${summary.breakdown.journeys.reporting.length}/${repos.length} repositories`,
    },
    components: {
      value: summary.componentStates.toLocaleString(),
      sub: `states across ${summary.breakdown.components.reporting.length}/${repos.length} repositories`,
    },
  };
  return (
    <Card className="mb-4 overflow-hidden">
      <CardHeader
        title="Confidence coverage"
        description="Three independent signals—never rolled into a misleading combined score"
      />
      <div className="grid divide-y divide-(--hairline) sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {SIGNALS.map((signal) => {
          const Icon = signal.icon;
          const open = selected === signal.key;
          return (
            <button
              key={signal.key}
              type="button"
              onClick={() => toggle(signal.key)}
              aria-expanded={open}
              aria-controls="confidence-signal-drilldown"
              title={signal.definition}
              className={`p-4 text-left transition-colors hover:bg-(--surface-2) sm:p-5 ${
                open ? "bg-(--surface-2)" : ""
              }`}
            >
              <span className="flex items-center gap-1.5 text-xs font-medium text-(--muted)">
                <Icon size={14} /> {signal.label}
                <ChevronDown
                  size={13}
                  className={`ml-auto transition-transform ${open ? "rotate-180" : ""}`}
                  aria-hidden="true"
                />
              </span>
              <span className="mt-2 block text-2xl font-semibold">
                {headline[signal.key].value}
              </span>
              <span className="mt-1 block text-xs text-(--muted)">{headline[signal.key].sub}</span>
            </button>
          );
        })}
      </div>
      {selected ? (
        <SignalDrilldown
          signal={signalByKey[selected]}
          breakdown={summary.breakdown[selected]}
          total={repos.length}
        />
      ) : null}
    </Card>
  );
}

function RepoChipLink({ repo, href }: { repo: string; href: string }) {
  return (
    <Link
      to={href}
      className="rounded-full border border-(--hairline) bg-(--surface) px-2.5 py-1 font-mono text-[11px] text-(--ink-2) transition-colors hover:border-(--muted) hover:text-(--ink)"
    >
      {repo}
    </Link>
  );
}

/** The expandable "which repos?" panel under a selected confidence tile. */
function SignalDrilldown({
  signal,
  breakdown,
  total,
}: {
  signal: SignalDefinition;
  breakdown: SignalBreakdown;
  total: number;
}) {
  return (
    <div
      id="confidence-signal-drilldown"
      className="border-t border-(--hairline) px-4 py-4 sm:px-5"
    >
      <p className="text-xs text-(--ink-2)">
        <span className="font-semibold">{signal.label}:</span> {signal.definition}
      </p>
      {breakdown.missing.length === 0 ? (
        <p className="mt-3 flex items-center gap-2 text-xs text-(--ink-2)">
          <CheckCircle2 size={14} className="shrink-0 text-(--good)" />
          {total === 1 ? "Your repository reports" : `All ${total} repositories report`} this
          signal. Lovely.
        </p>
      ) : (
        <div className="mt-3">
          <p className="text-xs font-medium text-(--muted)">
            Not reporting yet ({breakdown.missing.length} of {total}) · {signal.missingHint}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {breakdown.missing.map((repo) => (
              <RepoChipLink key={repo} repo={repo} href={signal.setupHref(repo)} />
            ))}
          </div>
        </div>
      )}
      {breakdown.reporting.length > 0 && breakdown.missing.length > 0 ? (
        <div className="mt-3">
          <p className="text-xs font-medium text-(--muted)">
            Reporting ({breakdown.reporting.length})
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {breakdown.reporting.map((repo) => (
              <RepoChipLink key={repo} repo={repo} href={`/r/${repo}`} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SnapshotCell({
  icon: Icon,
  label,
  info,
  value,
  detail,
  href,
}: {
  icon: typeof BookOpen;
  label: string;
  info?: string;
  value: string;
  detail: string;
  href: string;
}) {
  return (
    <Link to={href} className="group min-w-0 p-4 transition-colors hover:bg-(--surface-2) sm:p-5">
      <span className="flex items-center gap-2 text-xs font-medium text-(--muted)">
        <Icon size={14} /> {label} {info ? <InfoHint text={info} /> : null}
      </span>
      <span className="mt-2 block truncate text-[15px] font-semibold group-hover:underline">
        {value}
      </span>
      <span className="mt-1 block truncate text-xs text-(--muted)">{detail}</span>
    </Link>
  );
}
