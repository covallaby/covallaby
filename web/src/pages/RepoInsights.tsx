import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { type DirTrends, api } from "../api.js";
import { Card, CardHeader } from "../components/ui.js";
import { CommitWaterfall, CoverageCalendar, DirectoryStream } from "../components/viz.js";
import { useRepo } from "./Repo.js";

export function Insights() {
  const { repo, data } = useRepo();
  const navigate = useNavigate();
  const [dirs, setDirs] = useState<DirTrends | null>(null);

  useEffect(() => {
    setDirs(null);
    api
      .dirTrends(repo, data.branch)
      .then(setDirs)
      .catch(() => setDirs(null));
  }, [repo, data.branch]);

  if (data.history.length < 2) {
    return (
      <p className="text-sm text-(--muted)">
        A couple of uploads on this branch unlock the insight charts. 🦘
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="What moved coverage"
          description={`Change per upload on ${data.branch} — click a bar to open that commit`}
        />
        <div className="px-4 pb-4">
          <CommitWaterfall history={data.history} onPick={(id) => navigate(`/r/${repo}/u/${id}`)} />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Coverage calendar"
          description="Daily coverage — cadence and drift at a glance"
        />
        <div className="px-5 pb-4">
          <CoverageCalendar history={data.history} />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="By directory"
          description="Covered lines per top-level folder over time"
        />
        <div className="px-4 pb-4">
          {dirs ? (
            <DirectoryStream data={dirs} />
          ) : (
            <p className="px-1 py-6 text-sm text-(--muted)">Loading the folder breakdown…</p>
          )}
        </div>
      </Card>
    </div>
  );
}
