import { ArrowRight, Images } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { type CompareResult, type StorybookPreview, api, formatPercent, severity } from "../api.js";
import { ChangesList } from "../components/changes-list.js";
import { ScopePicker } from "../components/scope-picker.js";
import { PageSkeleton } from "../components/skeleton.js";
import { Card, CardHeader, DeltaChip, Meter, inkFor } from "../components/ui.js";
import { VerdictCard } from "../components/verdict-card.js";
import { PatchTreemap } from "../components/viz.js";

function CompareBody({
  repo,
  result,
  headLabel,
}: {
  repo: string;
  result: CompareResult;
  headLabel: string;
}) {
  const { head, base, same, changes } = result;
  const delta = head.percent !== null && base.percent !== null ? head.percent - base.percent : null;
  return (
    <div className="space-y-4">
      <VerdictCard repo={repo} verdict={result.verdict} baseline={result.baseline} />

      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <div className="text-xs text-(--muted)">
            {headLabel} vs <span className="font-mono">{base.branch}</span> @{" "}
            <span className="font-mono">{base.commit.slice(0, 7)}</span>
          </div>
          <div
            className={`mt-1 flex items-center gap-3 text-[44px] leading-none font-semibold tracking-tighter ${inkFor[severity(head.percent)]}`}
          >
            {formatPercent(head.percent)}
            <DeltaChip current={head.percent} previous={base.percent} />
          </div>
          <p className="mt-2 text-sm text-(--ink-2)">
            {same
              ? "Head and base are the same upload — nothing to compare yet."
              : delta === null
                ? "Not enough data to compare."
                : delta >= 1
                  ? "Nice jump! This is ahead of the base. 🎉"
                  : delta <= -1
                    ? "This trails the base — worth a look before merging."
                    : "Neck and neck with the base."}
          </p>
          <Meter percent={head.percent} className="mt-3 w-72" />
        </div>
        <div className="flex flex-wrap gap-8 pb-1.5">
          <div>
            <div className="text-xl font-semibold tracking-tight">
              {formatPercent(base.percent)}
            </div>
            <div className="mt-0.5 text-xs text-(--muted)">base ({base.branch})</div>
          </div>
          <div>
            <div className="text-xl font-semibold tracking-tight">
              {head.linesCovered.toLocaleString()}
              <span className="text-[14px] font-normal text-(--muted)">
                /{head.linesTotal.toLocaleString()}
              </span>
            </div>
            <div className="mt-0.5 text-xs text-(--muted)">head lines</div>
          </div>
          <div>
            <div className="text-xl font-semibold tracking-tight">
              <Link
                className="font-mono text-[15px] hover:underline"
                to={`/r/${repo}/u/${head.id}`}
              >
                {head.commit.slice(0, 7)}
              </Link>
            </div>
            <div className="mt-0.5 text-xs text-(--muted)">head upload</div>
          </div>
        </div>
      </div>

      {changes && (changes.added.length > 0 || changes.changed.length > 0) && (
        <Card>
          <CardHeader
            title="Did the change get tested?"
            description="New & changed files — size ≈ impact, color = coverage"
          />
          <div className="px-4 pb-4">
            <PatchTreemap changes={changes} />
          </div>
        </Card>
      )}

      {changes && (
        <Card>
          <CardHeader
            title="What this changes"
            description={`Per-file differences vs ${base.branch} — project view, not line-level patch (that lives in the PR comment)`}
          />
          <ChangesList
            changes={changes}
            removedNote={(n) =>
              `${n} ${n === 1 ? "file" : "files"} on the base ${n === 1 ? "is" : "are"} gone from the head (deleted or renamed).`
            }
            emptyNote="No per-file differences — same code, same coverage."
          />
        </Card>
      )}
    </div>
  );
}

export function PullRequest() {
  const { owner, name, pr } = useParams();
  const repo = `${owner}/${name}`;
  const [params] = useSearchParams();
  const base = params.get("base") ?? "main";
  const [result, setResult] = useState<CompareResult | null>(null);
  const [componentPreview, setComponentPreview] = useState<StorybookPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .compare(repo, { pr: Number(pr), base })
      .then(setResult)
      .catch((e) => setError(String(e)));
  }, [repo, pr, base]);
  useEffect(() => {
    api
      .storybookPreviews(repo)
      .then(({ previews }) =>
        setComponentPreview(previews.find((preview) => preview.pr === Number(pr)) ?? null),
      )
      .catch(() => setComponentPreview(null));
  }, [repo, pr]);
  if (error) return <p className="text-sm text-(--bad)">{error}</p>;
  if (!result) return <PageSkeleton />;
  return (
    <div className="space-y-3">
      <Link to={`/r/${repo}/pulls`} className="text-xs text-(--muted) hover:text-(--ink)">
        ← All pull requests
      </Link>
      {componentPreview ? (
        <Link
          to={`/r/${repo}/storybook-previews/${componentPreview.id}`}
          className="group flex items-center gap-3 rounded-xl border border-(--border) bg-(--surface) px-4 py-3 transition-colors hover:border-(--accent)/60 hover:bg-(--surface-2)"
        >
          <span className="rounded-lg bg-(--accent-wash) p-2 text-(--accent)">
            <Images size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">Component changes for PR #{pr}</span>
            <span className="mt-0.5 block text-xs text-(--muted)">
              {componentPreview.imageCount ?? 0} states · compare visual changes with {base}
            </span>
          </span>
          <span className="inline-flex items-center gap-1 text-xs font-medium text-(--accent) group-hover:underline">
            View diff <ArrowRight size={14} />
          </span>
        </Link>
      ) : null}
      <CompareBody repo={repo} result={result} headLabel={`PR #${pr}`} />
    </div>
  );
}

export function CompareBranches() {
  const { owner, name } = useParams();
  const repo = `${owner}/${name}`;
  const [params, setParams] = useSearchParams();
  const head = params.get("head") ?? "";
  const base = params.get("base") ?? "main";
  const [branches, setBranches] = useState<string[]>([]);
  const [result, setResult] = useState<CompareResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: run once per repo; params/setParams are stable router utilities
  useEffect(() => {
    api.history(repo).then((d) => {
      setBranches(d.branches);
      if (!params.get("head") && d.branches[0]) {
        setParams((prev) => {
          const p = new URLSearchParams(prev);
          p.set("head", d.branches[0]!);
          return p;
        });
      }
    });
  }, [repo]);

  useEffect(() => {
    if (!head) return;
    setResult(null);
    api
      .compare(repo, { head, base })
      .then((r) => {
        setResult(r);
        setError(null);
      })
      .catch((e) => setError(String(e)));
  }, [repo, head, base]);

  const pick = (key: "head" | "base") => (value: string) =>
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set(key, value);
      return p;
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold tracking-tight">Compare</h1>
        <ScopePicker
          label="Head branch"
          current={head}
          branches={branches}
          onSelectBranch={pick("head")}
          className="w-56"
        />
        <span className="text-(--muted)">vs</span>
        <ScopePicker
          label="Base branch"
          current={base}
          branches={branches}
          onSelectBranch={pick("base")}
          className="w-56"
        />
      </div>
      {error && <p className="text-sm text-(--bad)">{error}</p>}
      {!error && !result && head && <PageSkeleton />}
      {result && <CompareBody repo={repo} result={result} headLabel={head} />}
    </div>
  );
}
