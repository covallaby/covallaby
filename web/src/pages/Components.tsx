import { ArrowRight, GitBranch, GitPullRequest, Images } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { type StorybookPreview, api } from "../api.js";
import { PageSkeleton } from "../components/skeleton.js";
import { BranchTag, Card, CardHeader } from "../components/ui.js";
import { useRepo, when } from "./Repo.js";
import { componentPreviewSections } from "./component-previews.js";

const verdictTone: Record<string, string> = {
  pending: "bg-(--warn-wash) text-(--warn)",
  rejected: "bg-(--bad-wash) text-(--bad)",
  approved: "bg-(--good-wash) text-(--good)",
  "auto-accepted": "bg-(--good-wash) text-(--good)",
};

function Verdict({ preview }: { preview: StorybookPreview }) {
  const label =
    preview.reviewState === "auto-accepted"
      ? "Current"
      : (preview.reviewState?.replace("-", " ") ?? preview.status);
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${verdictTone[preview.reviewState ?? ""] ?? "bg-(--surface-2) text-(--muted)"}`}
    >
      {label}
    </span>
  );
}

/** Repository-wide home for the current component library and change-specific diffs. */
export function Components() {
  const { repo, data } = useRepo();
  const [previews, setPreviews] = useState<StorybookPreview[] | null>(null);
  useEffect(() => {
    setPreviews(null);
    api
      .storybookPreviews(repo)
      .then((result) => setPreviews(result.previews))
      .catch(() => setPreviews([]));
  }, [repo]);
  const sections = useMemo(
    () => componentPreviewSections(previews ?? [], data.branch),
    [previews, data.branch],
  );

  if (!previews) return <PageSkeleton />;

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <CardHeader
          title={`Current components on ${data.branch}`}
          description="The latest component library that landed on the default branch"
        />
        {sections.current ? (
          <Link
            to={`/r/${repo}/storybook-previews/${sections.current.id}?filter=all`}
            className="group flex flex-col gap-4 border-t border-(--hairline) p-5 transition-colors hover:bg-(--surface-2) sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex min-w-0 items-start gap-3">
              <span className="rounded-lg bg-(--good-wash) p-2 text-(--good)">
                <Images size={20} />
              </span>
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">
                    {sections.current.imageCount ?? 0} component states
                  </span>
                  <Verdict preview={sections.current} />
                </span>
                <span className="mt-1 block text-xs text-(--muted)">
                  <span className="font-mono">{sections.current.commit.slice(0, 10)}</span> ·{" "}
                  {when(sections.current.createdAt)}
                </span>
              </span>
            </div>
            <span className="inline-flex items-center gap-1 text-xs font-medium text-(--accent) group-hover:underline">
              Browse current library <ArrowRight size={14} />
            </span>
          </Link>
        ) : (
          <p className="border-t border-(--hairline) px-5 py-5 text-sm text-(--muted)">
            No component library has landed on {data.branch} yet.
          </p>
        )}
      </Card>

      <Card className="overflow-hidden">
        <CardHeader
          title="Component changes"
          description={`The latest visual diff from each pull request or branch, compared with ${data.branch}`}
        />
        {sections.changes.length ? (
          <div className="divide-y divide-(--hairline) border-t border-(--hairline)">
            {sections.changes.map((preview) => (
              <Link
                key={preview.id}
                to={`/r/${repo}/storybook-previews/${preview.id}`}
                className="group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-(--surface-2)"
              >
                {preview.pr ? (
                  <GitPullRequest size={16} className="shrink-0 text-(--muted)" />
                ) : (
                  <GitBranch size={16} className="shrink-0 text-(--muted)" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2 text-sm font-medium group-hover:underline">
                    {preview.pr ? `PR #${preview.pr}` : preview.branch}
                    <Verdict preview={preview} />
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-(--muted)">
                    <BranchTag branch={preview.branch} pr={preview.pr} />
                    <span className="font-mono">{preview.commit.slice(0, 7)}</span>
                    <span>
                      · {preview.imageCount ?? 0} states · {when(preview.createdAt)}
                    </span>
                  </span>
                </span>
                <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-(--accent)">
                  View diff <ArrowRight size={14} />
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="border-t border-(--hairline) px-5 py-5 text-sm text-(--muted)">
            No pull request or branch component diffs yet.
          </p>
        )}
      </Card>
    </div>
  );
}
