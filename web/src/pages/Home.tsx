import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { type RepoOverview, api, formatPercent, severity } from "../api.js";
import { Sparkline } from "../components/charts.js";
import { Card, DeltaChip, Meter, inkFor } from "../components/ui.js";

export function Home() {
  const [repos, setRepos] = useState<RepoOverview[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .repos()
      .then((d) => setRepos(d.repos))
      .catch((e) => setError(String(e)));
  }, []);

  if (error) return <p className="text-sm text-(--bad)">{error}</p>;
  if (!repos) return null;

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

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
                  <div className="mt-2 flex items-center gap-2 text-xs text-(--muted)">
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
  );
}
