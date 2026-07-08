import { Card, CardHeader } from "../components/ui.js";
import { UploadsTable, useRepo } from "./Repo.js";

export function Uploads() {
  const { repo, data } = useRepo();
  return (
    <Card>
      <CardHeader
        title="Uploads"
        description={
          data.history.length > 0
            ? `${data.history.length} on ${data.branch}, newest first`
            : `Nothing on ${data.branch} yet`
        }
      />
      {data.history.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-(--muted)">
          No uploads on this branch. CI will hop them in. 🦘
        </p>
      ) : (
        <div className="px-1 pb-1">
          <UploadsTable repo={repo} history={data.history} />
        </div>
      )}
    </Card>
  );
}
