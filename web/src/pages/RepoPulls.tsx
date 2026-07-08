import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { type PROverview, api, formatPercent, severity } from "../api.js";
import { PageSkeleton } from "../components/skeleton.js";
import { Card, CardHeader, Meter, inkFor } from "../components/ui.js";
import { useRepo, when } from "./Repo.js";

export function PullRequests() {
  const { repo } = useRepo();
  const [prs, setPrs] = useState<PROverview[] | null>(null);
  useEffect(() => {
    setPrs(null);
    api
      .prs(repo)
      .then((d) => setPrs(d.prs))
      .catch(() => setPrs([]));
  }, [repo]);

  if (!prs) return <PageSkeleton />;

  return (
    <Card>
      <CardHeader
        title="Pull requests"
        description="Latest coverage per PR — open one to see what the change tested"
      />
      {prs.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-(--muted)">
          No pull-request uploads yet. Add <span className="font-mono">&pr=$PR</span> to the upload
          URL from CI and they'll show up here. 🦘
        </p>
      ) : (
        <div className="px-2 pb-2">
          {prs.map((p) => (
            <Link
              key={p.pr}
              to={`/r/${repo}/pr/${p.pr}`}
              className="grid grid-cols-[minmax(0,1fr)_auto_120px] items-center gap-4 rounded-lg px-3 py-2.5 transition-colors hover:bg-(--surface-2)"
            >
              <span className="min-w-0">
                <span className="block truncate text-[13.5px] font-medium">
                  #{p.pr}{" "}
                  <span className="font-mono font-normal text-(--muted)">
                    {p.latest.commit.slice(0, 7)}
                  </span>
                </span>
                <span className="block text-[11.5px] text-(--muted)">
                  {p.uploads} {p.uploads === 1 ? "upload" : "uploads"} · {p.latest.branch} ·{" "}
                  {when(p.latest.createdAt)}
                </span>
              </span>
              <span
                className={`text-[13px] font-semibold tabular-nums ${inkFor[severity(p.latest.percent)]}`}
              >
                {formatPercent(p.latest.percent)}
              </span>
              <Meter percent={p.latest.percent} />
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}
