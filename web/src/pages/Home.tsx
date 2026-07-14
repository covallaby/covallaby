import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  type PortfolioTrends,
  type RepoOverview,
  type UploadRow,
  api,
  formatPercent,
  groupReposByOwner,
  severity,
  shortRepoName,
} from "../api.js";
import mascotUrl from "../assets/mascot.png";
import { Sparkline } from "../components/charts.js";
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
  Pct,
  Td,
  Th,
  inkFor,
} from "../components/ui.js";
import { CoverageDebt, RiskQuadrant } from "../components/viz.js";

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

export function Home({ repos }: { repos: RepoOverview[] | null }) {
  const { owner } = useParams();
  const [activity, setActivity] = useState<UploadRow[] | null>(null);
  const [trends, setTrends] = useState<PortfolioTrends | null>(null);
  useEffect(() => {
    api
      .activity()
      .then((d) => setActivity(d.uploads))
      .catch(() => setActivity([]));
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
  const shownActivity = orgFilter
    ? (activity ?? []).filter((u) => u.repo.split("/")[0] === orgFilter)
    : (activity ?? []);

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
  const lastUpload = shownActivity[0];

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
      <PortfolioReviewQueue repos={shown} />
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

      <Card className="mt-4">
        <CardHeader title="Recent activity" description="Latest uploads across every repository" />
        <div
          className="max-w-full overflow-x-auto overscroll-x-contain px-1 pb-1"
          data-mobile-scroll-region
        >
          <table className="w-full min-w-[680px] text-[13.5px]">
            <thead>
              <tr>
                <Th>Repository</Th>
                <Th>Commit</Th>
                <Th>Branch</Th>
                <Th>When</Th>
                <Th right>Coverage</Th>
              </tr>
            </thead>
            <tbody>
              {shownActivity.map((u) => (
                <tr key={u.id} className="transition-colors hover:bg-(--surface-2)">
                  <Td>
                    <Link to={`/r/${u.repo}`} className="font-mono text-[12.5px] hover:underline">
                      {u.repo}
                    </Link>
                  </Td>
                  <Td>
                    <Link
                      to={`/r/${u.repo}/u/${u.id}`}
                      className="font-mono text-[12.5px] hover:underline"
                    >
                      {u.commit.slice(0, 10)}
                    </Link>
                    {u.pr ? <span className="ml-1.5 text-(--muted)">#{u.pr}</span> : null}
                  </Td>
                  <Td>
                    <BranchTag branch={u.branch} pr={u.pr} repo={u.repo} />
                  </Td>
                  <Td className="text-(--muted)">{ago(u.createdAt)}</Td>
                  <Td className="text-right">
                    <Pct percent={u.percent} />
                  </Td>
                </tr>
              ))}
              {shownActivity.length === 0 && (
                <tr>
                  <Td className="text-(--muted)">
                    Quiet in here — uploads from CI will hop in soon. 🦘
                  </Td>
                  <Td />
                  <Td />
                  <Td />
                  <Td />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
