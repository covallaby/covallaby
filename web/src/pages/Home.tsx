import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { type RepoOverview, type UploadRow, api, formatPercent, severity } from "../api.js";
import { Sparkline } from "../components/charts.js";
import { Skeleton } from "../components/skeleton.js";
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
  const navigate = useNavigate();
  const [activity, setActivity] = useState<UploadRow[] | null>(null);
  useEffect(() => {
    api
      .activity()
      .then((d) => setActivity(d.uploads))
      .catch(() => setActivity([]));
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
      <Card className="mx-auto mt-12 max-w-xl p-7">
        <h2 className="text-lg font-semibold tracking-tight">No coverage yet — let's fix that</h2>
        <p className="mt-2 text-sm text-(--ink-2)">
          Upload any coverage file (LCOV, JaCoCo, Cobertura, xccov) from CI or your machine:
        </p>
        <pre className="mt-4 overflow-x-auto rounded-xl border border-(--hairline) bg-(--surface-2) p-4 font-mono text-xs leading-relaxed">
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

  const totalCovered = repos.reduce((n, r) => n + r.latest.linesCovered, 0);
  const totalLines = repos.reduce((n, r) => n + r.latest.linesTotal, 0);
  const overall = totalLines === 0 ? null : (totalCovered / totalLines) * 100;
  const worst = [...repos].sort(
    (a, b) => (a.latest.percent ?? 101) - (b.latest.percent ?? 101),
  )[0]!;
  const lastUpload = activity?.[0];

  return (
    <div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Tile
          label="Overall coverage"
          value={<span className={inkFor[severity(overall)]}>{formatPercent(overall)}</span>}
          sub={`${totalCovered.toLocaleString()} of ${totalLines.toLocaleString()} lines`}
        />
        <Tile label="Repositories" value={repos.length} />
        <Tile
          label="Needs some love"
          value={
            <Link to={`/r/${worst.repo}`} className="hover:underline">
              <span className={`font-mono text-[17px] ${inkFor[severity(worst.latest.percent)]}`}>
                {worst.repo.split("/")[1]}
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

      <h2 className="mt-6 mb-3 text-[13.5px] font-semibold tracking-tight">Repositories</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {repos.map((r) => {
          const prev = r.trend.length > 1 ? r.trend[r.trend.length - 2] : null;
          return (
            <Link key={r.repo} to={`/r/${r.repo}`} className="group">
              <Card className="p-5 transition-all duration-150 group-hover:-translate-y-0.5 group-hover:border-(--muted)">
                <div className="mb-4 flex items-center justify-between font-mono text-[13px] text-(--ink-2)">
                  <span>{r.repo}</span>
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
                      {r.latest.linesCovered.toLocaleString()} of{" "}
                      {r.latest.linesTotal.toLocaleString()} lines{" "}
                      <DeltaChip current={r.latest.percent} previous={prev} />
                    </div>
                  </div>
                  <Sparkline points={r.trend} />
                </div>
                <Meter percent={r.latest.percent} className="mt-4" />
              </Card>
            </Link>
          );
        })}
      </div>

      <Card className="mt-4">
        <CardHeader title="Recent activity" description="Latest uploads across every repository" />
        <div className="px-1 pb-1">
          <table className="w-full text-[13.5px]">
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
              {(activity ?? []).map((u) => (
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
                  <Td className="text-(--muted)">{u.branch}</Td>
                  <Td className="text-(--muted)">{ago(u.createdAt)}</Td>
                  <Td className="text-right">
                    <Pct percent={u.percent} />
                  </Td>
                </tr>
              ))}
              {activity?.length === 0 && (
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
