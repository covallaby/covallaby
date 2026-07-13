import { AlertTriangle, CheckCircle2, CirclePlay, Code2, Images } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { type ReviewSignals, api, formatPercent } from "../api.js";
import { type CommitCheck, buildCommitChecks } from "../checks.js";
import { Card, CardHeader } from "../components/ui.js";
import { useRepo, when } from "./Repo.js";

export function Commits() {
  const { repo, data } = useRepo();
  const [signals, setSignals] = useState<ReviewSignals | null>(null);
  useEffect(() => {
    api
      .reviewSignals(repo)
      .then((result) => setSignals(result.repositories[0] ?? { repo, runs: [], previews: [] }));
  }, [repo]);
  const checks = useMemo(
    () => buildCommitChecks(data.history, signals?.runs ?? [], signals?.previews ?? []),
    [data.history, signals],
  );
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Commits"
        description="Code, browser journeys, and component evidence joined by commit SHA"
      />
      <div className="divide-y divide-(--hairline)">
        {checks.map((check) => (
          <CommitCheckRow key={check.commit} check={check} repo={repo} />
        ))}
      </div>
    </Card>
  );
}

export function CommitCheckRow({ check, repo }: { check: CommitCheck; repo: string }) {
  const StatusIcon = check.status === "ready" ? CheckCircle2 : AlertTriangle;
  const tone =
    check.status === "ready"
      ? "text-(--good)"
      : check.status === "failed"
        ? "text-(--bad)"
        : "text-(--warn)";
  return (
    <article className="px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StatusIcon size={17} className={tone} />
            <span className={`text-sm font-semibold ${tone}`}>
              {check.status === "ready"
                ? "Ready"
                : check.status === "failed"
                  ? "Blocked"
                  : "Incomplete"}
            </span>
            <span className="font-mono text-xs">{check.commit.slice(0, 10)}</span>
            {check.pr ? <span className="text-xs text-(--muted)">PR #{check.pr}</span> : null}
          </div>
          <p className="mt-1 truncate text-xs text-(--muted)">
            {check.branch} · {when(check.createdAt)}
          </p>
        </div>
        {check.missing.length ? (
          <span className="text-xs text-(--warn)">Missing {check.missing.join(" + ")}</span>
        ) : null}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <Signal
          icon={Code2}
          label="Code"
          value={check.coverage ? formatPercent(check.coverage.percent) : "Not reported"}
          href={check.coverage ? `/r/${repo}/u/${check.coverage.id}` : undefined}
        />
        <Signal
          icon={CirclePlay}
          label="Journeys"
          value={
            check.journey
              ? `${check.journey.testsPassed} passed${check.journey.testsFailed ? ` · ${check.journey.testsFailed} failed` : ""}`
              : "Not reported"
          }
          href={check.journey ? `/r/${repo}/test-runs/${check.journey.id}` : undefined}
        />
        <Signal
          icon={Images}
          label="Components"
          value={
            check.components
              ? `${check.components.imageCount ?? 0} states captured`
              : "Not reported"
          }
          href={
            check.components ? `/r/${repo}/storybook-previews/${check.components.id}` : undefined
          }
        />
      </div>
    </article>
  );
}

function Signal({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: typeof Code2;
  label: string;
  value: string;
  href?: string;
}) {
  const content = (
    <>
      <span className="flex items-center gap-1.5 text-[11px] font-medium text-(--muted)">
        <Icon size={13} /> {label}
      </span>
      <span className="mt-1 block text-xs font-medium">{value}</span>
    </>
  );
  return href ? (
    <Link to={href} className="rounded-lg border border-(--hairline) p-2.5 hover:bg-(--surface-2)">
      {content}
    </Link>
  ) : (
    <div className="rounded-lg border border-dashed border-(--hairline) p-2.5 text-(--muted)">
      {content}
    </div>
  );
}
