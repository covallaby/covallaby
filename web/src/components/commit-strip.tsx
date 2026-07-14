import { CirclePlay, Code2, GitCommit, GitPullRequest, Images, ListChecks } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { type CommitSiblings, type UploadRow, api, formatPercent } from "../api.js";

/**
 * The internal home of a commit SHA: the coverage upload page when one exists
 * for that exact SHA, otherwise the repo's Commits page (the commit envelope).
 */
export function commitHref(repo: string, commit: string, uploads?: UploadRow[] | null): string {
  const upload = uploads?.find((u) => u.commit === commit);
  return upload ? `/r/${repo}/u/${upload.id}` : `/r/${repo}/commits`;
}

/** Fetch every artifact recorded for a repo+SHA (null while loading or on error). */
export function useCommitSiblings(
  repo: string | undefined,
  commit: string | undefined,
): CommitSiblings | null {
  const [siblings, setSiblings] = useState<CommitSiblings | null>(null);
  useEffect(() => {
    setSiblings(null);
    if (!repo || !commit) return;
    let active = true;
    api
      .commitSiblings(repo, commit)
      .then((result) => {
        if (active) setSiblings(result);
      })
      .catch(() => {
        if (active) setSiblings(null);
      });
    return () => {
      active = false;
    };
  }, [repo, commit]);
  return siblings;
}

function StripLink({
  to,
  icon: Icon,
  children,
}: {
  to: string;
  icon: typeof Code2;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1.5 rounded-full border border-(--border) bg-(--surface-2) px-2.5 py-1 text-[11.5px] font-medium text-(--ink-2) transition-colors hover:border-(--muted) hover:text-(--ink)"
    >
      <Icon size={12} /> {children}
    </Link>
  );
}

/**
 * The commit is the envelope: a compact strip on every evidence detail page
 * linking to the siblings recorded for the same SHA — coverage upload, journey
 * run, component captures, the PR view, and the commit's row on Commits.
 */
export function CommitStrip({
  repo,
  commit,
  pr,
  current,
  siblings,
}: {
  repo: string;
  commit: string;
  pr: number | null;
  /** The surface this strip renders on — its own link is skipped. */
  current: "coverage" | "journeys" | "components";
  siblings: CommitSiblings | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-(--border) bg-(--surface) px-3 py-2">
      <span className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold tracking-wide text-(--muted) uppercase">
        <GitCommit size={13} /> This commit
      </span>
      <span className="font-mono text-xs text-(--ink-2)">{commit.slice(0, 10)}</span>
      {siblings?.upload && current !== "coverage" ? (
        <StripLink to={`/r/${repo}/u/${siblings.upload.id}`} icon={Code2}>
          Coverage {formatPercent(siblings.upload.percent)}
        </StripLink>
      ) : null}
      {siblings?.run && current !== "journeys" ? (
        <StripLink to={`/r/${repo}/test-runs/${siblings.run.id}`} icon={CirclePlay}>
          Journey run
        </StripLink>
      ) : null}
      {siblings?.preview && current !== "components" ? (
        <StripLink to={`/r/${repo}/storybook-previews/${siblings.preview.id}`} icon={Images}>
          Component captures
        </StripLink>
      ) : null}
      {pr ? (
        <StripLink to={`/r/${repo}/pr/${pr}`} icon={GitPullRequest}>
          PR #{pr}
        </StripLink>
      ) : null}
      <StripLink to={`/r/${repo}/commits`} icon={ListChecks}>
        Commits
      </StripLink>
    </div>
  );
}
