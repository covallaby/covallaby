import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { type UploadDetail, api, formatPercent, severity } from "../api.js";
import { Breadcrumb, Explorer, childrenOf } from "../components/explorer.js";
import { PageSkeleton } from "../components/skeleton.js";
import { Treemap } from "../components/treemap.js";
import { Card, CardHeader, Meter, Pct, Td, Th, inkFor } from "../components/ui.js";

const VIEWS = [
  { key: "explore", label: "Explorer" },
  { key: "map", label: "Map" },
  { key: "files", label: "Files" },
] as const;

export function Upload() {
  const { owner, name, id } = useParams();
  const repo = `${owner}/${name}`;
  const [data, setData] = useState<UploadDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const initialView = VIEWS.find((v) => v.key === params.get("view"))?.key ?? "explore";
  const [view, setView] = useState<(typeof VIEWS)[number]["key"]>(initialView);
  const path = params.get("path") ?? "";
  const navigateTo = (next: string) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (next) p.set("path", next);
        else p.delete("path");
        return p;
      },
      { replace: false },
    );
  const [query, setQuery] = useState("");

  useEffect(() => {
    api
      .upload(id!)
      .then(setData)
      .catch((e) => setError(String(e)));
  }, [id]);

  // biome-ignore lint/correctness/useHookAtTopLevel: guarded returns below never skip this hook
  const scoped = useMemo(
    () => (data ? data.files.filter((f) => path === "" || f.path.startsWith(`${path}/`)) : []),
    [data, path],
  );
  // biome-ignore lint/correctness/useHookAtTopLevel: guarded returns below never skip this hook
  const files = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? scoped.filter((f) => f.path.toLowerCase().includes(q)) : scoped;
  }, [scoped, query]);
  // biome-ignore lint/correctness/useHookAtTopLevel: guarded returns below never skip this hook
  const currentChildren = useMemo(() => childrenOf(scoped, path), [scoped, path]);

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
            view === "explore"
              ? "One level at a time — every directory rolls up its children, worst first"
              : view === "map"
                ? "Area is code size, color is coverage — click a directory to zoom in"
                : `${files.length} files under ${path || "root"}, worst first`
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
        <Breadcrumb path={path} onNavigate={navigateTo} />
        {view === "explore" && <Explorer files={data.files} path={path} onNavigate={navigateTo} />}
        {view === "map" && <Treemap items={currentChildren} onNavigate={navigateTo} />}
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
