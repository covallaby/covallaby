import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { type UploadDetail, api, formatPercent, severity } from "../api.js";
import { PageSkeleton } from "../components/skeleton.js";
import { FileTree } from "../components/tree.js";
import { Treemap } from "../components/treemap.js";
import { Card, CardHeader, Meter, Pct, Td, Th, inkFor } from "../components/ui.js";

const VIEWS = [
  { key: "tree", label: "Tree" },
  { key: "map", label: "Map" },
  { key: "files", label: "Files" },
] as const;

export function Upload() {
  const { owner, name, id } = useParams();
  const repo = `${owner}/${name}`;
  const [data, setData] = useState<UploadDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [params] = useSearchParams();
  const initialView = VIEWS.find((v) => v.key === params.get("view"))?.key ?? "tree";
  const [view, setView] = useState<(typeof VIEWS)[number]["key"]>(initialView);
  const [query, setQuery] = useState("");

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

  if (error) return <p className="text-sm text-(--bad)">{error}</p>;
  if (!data) return <PageSkeleton />;

  const { row, totals } = data;
  const shown = files.slice(0, 200);
  const missed = totals.lines.total - totals.lines.covered;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <div className="text-xs text-(--muted)">
            Coverage at <span className="font-mono">{row.commit.slice(0, 10)}</span> on{" "}
            <span className="font-mono">{row.branch}</span>
            {row.pr ? <> · PR #{row.pr}</> : null}
          </div>
          <div
            className={`mt-1 text-[44px] leading-none font-semibold tracking-tighter ${inkFor[severity(row.percent)]}`}
          >
            {formatPercent(row.percent)}
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

      <Card>
        <CardHeader
          title="Where the coverage lives"
          description={
            view === "tree"
              ? "Every directory rolls up its children — worst first, click to drill in"
              : view === "map"
                ? "The big picture: area is code size, color is coverage"
                : `${files.length} files, worst first`
          }
          action={
            <div className="flex items-center gap-3">
              {view === "files" && (
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Filter files…"
                  className="w-52 rounded-lg border border-(--border) bg-(--surface) px-3 py-1.5 text-[13px] outline-none placeholder:text-(--muted) focus:border-(--muted)"
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
        {view === "tree" && <FileTree files={data.files} />}
        {view === "map" && <Treemap files={data.files} />}
        {view === "files" && (
          <div className="px-1 pb-1">
            <table className="w-full text-[13.5px]">
              <thead>
                <tr>
                  <Th>File</Th>
                  <Th>Missing lines</Th>
                  <Th right>Lines</Th>
                  <Th right>Coverage</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {shown.map((f) => (
                  <tr key={f.path} className="transition-colors hover:bg-(--surface-2)">
                    <Td className="font-mono text-[12.5px]">{f.path}</Td>
                    <Td className="max-w-64 truncate font-mono text-[12px] text-(--muted)">
                      <span title={f.missing}>{f.missing}</span>
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
                {files.length > shown.length && (
                  <tr>
                    <Td className="text-(--muted)">
                      …and {files.length - shown.length} more — narrow the filter.
                    </Td>
                    <Td />
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
                    <Td />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="text-sm">
        <Link to={`/r/${repo}`} className="text-(--ink-2) hover:underline">
          ← Back to {repo}
        </Link>
      </p>
    </div>
  );
}
