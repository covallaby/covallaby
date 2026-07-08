import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { type CompareResult, api, formatPercent, severity } from "../api.js";
import { PageSkeleton } from "../components/skeleton.js";
import { Card, CardHeader, DeltaChip, Meter, inkFor } from "../components/ui.js";

function ChangesList({ changes }: { changes: NonNullable<CompareResult["changes"]> }) {
  return (
    <div className="space-y-5 px-5 pb-4">
      {changes.added.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-(--muted) uppercase">
            New files ({changes.added.length})
          </h3>
          <div className="space-y-0.5">
            {changes.added.slice(0, 30).map((f) => (
              <div
                key={f.path}
                className="grid grid-cols-[minmax(0,1fr)_72px_56px_110px] items-center gap-3 rounded-lg px-2 py-1.5"
              >
                <span className="truncate font-mono text-[12.5px] text-(--ink-2)">{f.path}</span>
                <span className="text-right font-mono text-[11.5px] text-(--muted) tabular-nums">
                  {f.total} lines
                </span>
                <span
                  className={`text-right text-[12px] font-semibold tabular-nums ${inkFor[severity(f.percent)]}`}
                >
                  {formatPercent(f.percent)}
                </span>
                <Meter percent={f.percent} />
              </div>
            ))}
          </div>
        </div>
      )}
      {changes.changed.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-(--muted) uppercase">
            Coverage moved ({changes.changed.length})
          </h3>
          <div className="space-y-0.5">
            {changes.changed.slice(0, 30).map((f) => (
              <div
                key={f.path}
                className="grid grid-cols-[minmax(0,1fr)_150px_80px] items-center gap-3 rounded-lg px-2 py-1.5"
              >
                <span className="truncate font-mono text-[12.5px] text-(--ink-2)">{f.path}</span>
                <span className="text-right font-mono text-[12px] text-(--muted) tabular-nums">
                  {formatPercent(f.before)} →{" "}
                  <span className={inkFor[severity(f.after)]}>{formatPercent(f.after)}</span>
                </span>
                <span className="text-right">
                  <DeltaChip current={f.after} previous={f.before} />
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {changes.removed > 0 && (
        <p className="text-[12.5px] text-(--muted)">
          {changes.removed} {changes.removed === 1 ? "file" : "files"} on the base{" "}
          {changes.removed === 1 ? "is" : "are"} gone from the head (deleted or renamed).
        </p>
      )}
      {changes.added.length === 0 && changes.changed.length === 0 && changes.removed === 0 && (
        <p className="text-sm text-(--muted)">
          No per-file differences — same code, same coverage.
        </p>
      )}
    </div>
  );
}

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

      {changes && (
        <Card>
          <CardHeader
            title="What this changes"
            description={`Per-file differences vs ${base.branch} — project view, not line-level patch (that lives in the PR comment)`}
          />
          <ChangesList changes={changes} />
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
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .compare(repo, { pr: Number(pr), base })
      .then(setResult)
      .catch((e) => setError(String(e)));
  }, [repo, pr, base]);
  if (error) return <p className="text-sm text-(--bad)">{error}</p>;
  if (!result) return <PageSkeleton />;
  return <CompareBody repo={repo} result={result} headLabel={`PR #${pr}`} />;
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

  const pick = (key: "head" | "base") => (e: React.ChangeEvent<HTMLSelectElement>) =>
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set(key, e.target.value);
      return p;
    });

  const selectCls =
    "rounded-lg border border-(--border) bg-(--surface) px-3 py-1.5 font-mono text-[13px] outline-none focus:border-(--muted)";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold tracking-tight">Compare</h1>
        <select value={head} onChange={pick("head")} className={selectCls} aria-label="head branch">
          {branches.map((b) => (
            <option key={b}>{b}</option>
          ))}
        </select>
        <span className="text-(--muted)">vs</span>
        <select value={base} onChange={pick("base")} className={selectCls} aria-label="base branch">
          {branches.map((b) => (
            <option key={b}>{b}</option>
          ))}
        </select>
      </div>
      {error && <p className="text-sm text-(--bad)">{error}</p>}
      {!error && !result && head && <PageSkeleton />}
      {result && <CompareBody repo={repo} result={result} headLabel={head} />}
    </div>
  );
}
