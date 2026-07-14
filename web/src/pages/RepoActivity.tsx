import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { type RepoActivityFeed, api } from "../api.js";
import { ActivityTimeline, RunsUnsupportedNote } from "../components/activity-feed.js";
import { Card, CardHeader } from "../components/ui.js";
import { useRepo } from "./Repo.js";

/**
 * The repo's Activity tab: every piece of evidence — coverage uploads,
 * journey runs, and component captures — in one chronology. All branches by
 * default; the header's scope picker narrows it via `?branch=`. Rows reuse
 * the portfolio feed's grammar minus the repo badge (the repo is fixed here);
 * coverage richness stays on Summary and the detail pages.
 */
export function Activity() {
  const { repo } = useRepo();
  const [params] = useSearchParams();
  const branch = params.get("branch") ?? undefined;
  const [feed, setFeed] = useState<RepoActivityFeed | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    setFeed(null);
    setError(false);
    api
      .repoActivity(repo, branch)
      .then(setFeed)
      .catch(() => setError(true));
  }, [repo, branch]);

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Activity"
        description={
          branch
            ? `Coverage, journeys, and component captures on ${branch}`
            : "Coverage, journeys, and component captures across every branch — one feed, three signals"
        }
      />
      {error ? (
        <p className="px-5 pb-4 text-sm text-(--bad)">
          Couldn't load this repository's activity. Try again in a moment.
        </p>
      ) : (
        <ActivityTimeline
          items={feed ? feed.items : null}
          limit={60}
          emptyText={
            branch
              ? `Nothing on ${branch} yet — activity from CI will hop in soon. 🦘`
              : "Quiet in here — activity from CI will hop in soon. 🦘"
          }
        />
      )}
      {feed && !feed.runsSupported && <RunsUnsupportedNote />}
    </Card>
  );
}
