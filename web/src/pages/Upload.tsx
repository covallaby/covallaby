import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { type UploadDetail, api, formatPercent, severity } from "../api.js";
import { BaselineChip } from "../components/baseline-chip.js";
import { Breadcrumb, Hotspots, TreeOutline, buildTree } from "../components/explorer.js";
import { PageSkeleton } from "../components/skeleton.js";
import { Treemap } from "../components/treemap.js";
import {
  BranchTag,
  Card,
  CardHeader,
  DeltaChip,
  Meter,
  Pct,
  Td,
  Th,
  inkFor,
} from "../components/ui.js";
import { CoverageBarcode } from "../components/viz.js";

const VIEWS = [
  { key: "tree", label: "Tree" },
  { key: "changes", label: "Changes" },
  { key: "map", label: "Map" },
  { key: "lines", label: "Lines" },
  { key: "files", label: "Files" },
] as const;

const SWATCHES = [
  ["var(--good)", "90%+"],
  ["var(--ok)", "75%+"],
  ["var(--warn)", "60%+"],
  ["var(--bad)", "below"],
] as const;

export function Upload() {
  const { id } = useParams();
  const [data, setData] = useState<UploadDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const initialView = VIEWS.find((v) => v.key === params.get("view"))?.key ?? "tree";
  const [view, setView] = useState<(typeof VIEWS)[number]["key"]>(initialView);
  const [query, setQuery] = useState("");
  const path = params.get("path") ?? "";
  const navigateTo = (next: string) =>
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      if (next) p.set("path", next);
      else p.delete("path");
      return p;
    });

  useEffect(() => {
    api
      .upload(id!)
      .then(setData)
      .catch((e) => setError(String(e)));
  }, [id]);

  // biome-ignore lint/correctness/useHookAtTopLevel: guarded returns below never skip this hook
  const files = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return q ? data.files.filter((f) => f.path.toLowerCase().includes(q)) : data.files;
  }, [data, query]);
  // biome-ignore lint/correctness/useHookAtTopLevel: guarded returns below never skip this hook
  const tree = useMemo(() => (data ? buildTree(data.files) : null), [data]);
  const [showAll, setShowAll] = useState(false);

  if (error) return <p className="text-sm text-(--bad)">{error}</p>;
  if (!data) return <PageSkeleton />;

  const { row, totals, changes } = data;
  // No hard cap — just don't render thousands of rows unprompted. Default to the
  // worst 200 (they're sorted worst-first); "Show all" reveals the rest.
  const CAP = 200;
  const shown = showAll ? files : files.slice(0, CAP);
  const missed = totals.lines.total - totals.lines.covered;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <div className="flex items-center gap-2 text-xs text-(--muted)">
            <span>Coverage at</span>
            <span className="font-mono text-(--ink-2)">{row.commit.slice(0, 10)}</span>
            <BranchTag branch={row.branch} pr={row.pr} repo={row.repo} />
          </div>
          <div
            className={`mt-1 flex items-center gap-3 text-[44px] leading-none font-semibold tracking-tighter ${inkFor[severity(row.percent)]}`}
          >
            {formatPercent(row.percent)}
            {changes && <DeltaChip current={row.percent} previous={changes.prevPercent} />}
          </div>
          <p className="mt-2 text-sm text-(--ink-2)">
            {row.percent === null
              ? "Nothing coverable in this upload."
              : row.percent >= 90
                ? "You're covered."
                : row.percent >= 75
                  ? "Almost covered."
                  : `${missed.toLocaleString()} lines need some love.`}
          </p>
          <Meter percent={row.percent} className="mt-3 w-72" />
          <div className="mt-2.5">
            <BaselineChip baseline={data.baseline} />
          </div>
        </div>
        <div className="flex flex-wrap gap-8 pb-1.5">
          {totals.functions.total > 0 && (
            <div>
              <div className="text-xl font-semibold tracking-tight">
                {formatPercent(totals.functions.percent)}
              </div>
              <div className="mt-0.5 text-xs text-(--muted)">functions</div>
            </div>
          )}
          {totals.branches.total > 0 && (
            <div>
              <div className="text-xl font-semibold tracking-tight">
                {formatPercent(totals.branches.percent)}
              </div>
              <div className="mt-0.5 text-xs text-(--muted)">branches</div>
            </div>
          )}
          <div>
            <div className="text-xl font-semibold tracking-tight">{totals.files}</div>
            <div className="mt-0.5 text-xs text-(--muted)">files</div>
          </div>
          <div>
            <div className="text-xl font-semibold tracking-tight">{missed.toLocaleString()}</div>
            <div className="mt-0.5 text-xs text-(--muted)">missed lines</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_290px]">
        <Card>
          <CardHeader
            title="Where the coverage lives"
            description={
              view === "tree"
                ? "Opens where the missed lines are — search filters in place"
                : view === "changes"
                  ? changes
                    ? `vs ${changes.prevCommit.slice(0, 7)}, the previous upload on ${row.branch}`
                    : "First upload on this branch"
                  : view === "map"
                    ? "Click a directory block to zoom in, breadcrumb to climb out"
                    : view === "lines"
                      ? "Every executable line as one tick — see where the gaps cluster"
                      : `${files.length} files, worst first`
            }
            action={
              <div className="flex items-center gap-3">
                {(view === "tree" || view === "files" || view === "lines") && (
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Filter files…"
                    className="w-44 rounded-lg border border-(--border) bg-(--surface) px-3 py-1.5 text-[13px] outline-none placeholder:text-(--muted) focus:border-(--muted)"
                  />
                )}
                <div className="flex rounded-lg border border-(--hairline) p-0.5">
                  {VIEWS.map((v) => (
                    <button
                      key={v.key}
                      type="button"
                      onClick={() => setView(v.key)}
                      className={`rounded-md px-2.5 py-1 text-[12px] transition-colors ${
                        view === v.key
                          ? "bg-(--surface-2) font-medium text-(--ink)"
                          : "text-(--muted) hover:text-(--ink)"
                      }`}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
              </div>
            }
          />

          {view === "tree" && <TreeOutline files={data.files} query={query} />}

          {view === "changes" && (
            <div className="px-5 pb-4">
              {!changes ? (
                <p className="text-sm text-(--muted)">
                  This is the first upload on <span className="font-mono">{row.branch}</span> —
                  everything is new. The next upload gets a comparison. 🦘
                </p>
              ) : (
                <div className="space-y-5">
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
                            <span className="truncate font-mono text-[12.5px] text-(--ink-2)">
                              {f.path}
                            </span>
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
                            <span className="truncate font-mono text-[12.5px] text-(--ink-2)">
                              {f.path}
                            </span>
                            <span className="text-right font-mono text-[12px] text-(--muted) tabular-nums">
                              {formatPercent(f.before)} →{" "}
                              <span className={inkFor[severity(f.after)]}>
                                {formatPercent(f.after)}
                              </span>
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
                      {changes.removed} {changes.removed === 1 ? "file" : "files"} from the previous
                      upload {changes.removed === 1 ? "is" : "are"} gone (deleted or renamed).
                    </p>
                  )}
                  {changes.added.length === 0 &&
                    changes.changed.length === 0 &&
                    changes.removed === 0 && (
                      <p className="text-sm text-(--muted)">
                        Same files, same coverage — steady as she goes.
                      </p>
                    )}
                </div>
              )}
            </div>
          )}

          {view === "map" && tree && (
            <>
              <div className="flex items-center gap-4 px-5 pb-2 text-[11.5px] text-(--muted)">
                <span>Block size = lines of code</span>
                <span className="flex items-center gap-2">
                  color = coverage:
                  {SWATCHES.map(([c, label]) => (
                    <span key={label} className="flex items-center gap-1">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-[3px]"
                        style={{ background: c, opacity: 0.6 }}
                      />
                      {label}
                    </span>
                  ))}
                </span>
              </div>
              <Breadcrumb path={path} onNavigate={navigateTo} />
              <Treemap root={tree} path={path} onNavigate={navigateTo} />
            </>
          )}

          {view === "lines" && (
            <div className="px-5 pb-4">
              <div className="mb-3 flex items-center gap-4 text-[11.5px] text-(--muted)">
                <span className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-[3px]"
                    style={{ background: "var(--good)" }}
                  />
                  covered
                </span>
                <span className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-[3px]"
                    style={{ background: "var(--warn)" }}
                  />
                  branch missed
                </span>
                <span className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-[3px]"
                    style={{ background: "var(--bad)" }}
                  />
                  never hit
                </span>
              </div>
              <CoverageBarcode files={files} limit={12} />
            </div>
          )}

          {view === "files" && (
            <div
              className="max-w-full overflow-x-auto overscroll-x-contain px-1 pb-1"
              data-mobile-scroll-region
            >
              <table className="w-full min-w-[620px] text-[13.5px]">
                <thead>
                  <tr>
                    <Th>File</Th>
                    <Th right>Lines</Th>
                    <Th right>Coverage</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((f) => (
                    <tr key={f.path} className="transition-colors hover:bg-(--surface-2)">
                      <Td className="font-mono text-[12.5px]">
                        <span title={f.missing ? `missing ${f.missing}` : undefined}>{f.path}</span>
                      </Td>
                      <Td className="text-right font-mono text-[12.5px] text-(--muted) tabular-nums">
                        {f.covered}/{f.total}
                      </Td>
                      <Td className="text-right">
                        <Pct percent={f.percent} />
                      </Td>
                      <Td className="w-24">
                        <Meter percent={f.percent} />
                      </Td>
                    </tr>
                  ))}
                  {!showAll && files.length > shown.length && (
                    <tr>
                      <Td className="text-(--muted)">
                        Showing the worst {shown.length} of {files.length}.{" "}
                        <button
                          type="button"
                          onClick={() => setShowAll(true)}
                          className="font-medium text-(--ink-2) hover:text-(--ink) hover:underline"
                        >
                          Show all {files.length}
                        </button>{" "}
                        — or filter.
                      </Td>
                      <Td />
                      <Td />
                      <Td />
                    </tr>
                  )}
                  {files.length === 0 && (
                    <tr>
                      <Td className="text-(--muted)">No files match "{query}".</Td>
                      <Td />
                      <Td />
                      <Td />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Hotspots" description="Ranked by missed lines — click to filter" />
          <Hotspots
            files={data.files}
            onPick={(p) => {
              setView("tree");
              setQuery(p);
            }}
          />
        </Card>
      </div>
    </div>
  );
}
