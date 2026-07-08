import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { type UploadDetail, api, formatPercent, severity } from "../api.js";
import { PageSkeleton } from "../components/skeleton.js";
import { Card, Meter, Pct, SectionTitle, Stat, Td, Th, inkFor } from "../components/ui.js";

export function Upload() {
  const { owner, name, id } = useParams();
  const repo = `${owner}/${name}`;
  const [data, setData] = useState<UploadDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-6">
        <div>
          <div className="text-xs text-(--muted)">
            Coverage at <span className="font-mono">{row.commit.slice(0, 10)}</span> on{" "}
            <span className="font-mono">{row.branch}</span>
            {row.pr ? <> · PR #{row.pr}</> : null}
          </div>
          <div
            className={`mt-1 text-[52px] leading-none font-semibold tracking-tighter ${inkFor[severity(row.percent)]}`}
          >
            {formatPercent(row.percent)}
          </div>
          <Meter percent={row.percent} className="mt-4 w-72" />
        </div>
        <div className="flex flex-wrap gap-8 pb-1.5">
          {totals.functions.total > 0 && (
            <Stat value={formatPercent(totals.functions.percent)} label="functions" />
          )}
          {totals.branches.total > 0 && (
            <Stat value={formatPercent(totals.branches.percent)} label="branches" />
          )}
          <Stat value={totals.files} label="files" />
          <Stat
            value={(totals.lines.total - totals.lines.covered).toLocaleString()}
            label="missed lines"
          />
        </div>
      </div>

      <SectionTitle>By directory</SectionTitle>
      <Card className="px-1 pt-3 pb-1">
        <table className="w-full text-[13.5px]">
          <thead>
            <tr>
              <Th>Directory</Th>
              <Th right>Lines</Th>
              <Th right>Coverage</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {data.directories.map((d) => (
              <tr key={d.path} className="transition-colors hover:bg-(--surface-2)">
                <Td className="font-mono text-[12.5px]">{d.path}/</Td>
                <Td className="text-right font-mono text-[12.5px] text-(--muted) tabular-nums">
                  {d.covered.toLocaleString()}/{d.total.toLocaleString()}
                </Td>
                <Td className="text-right">
                  <Pct percent={d.percent} />
                </Td>
                <Td className="w-28">
                  <Meter percent={d.percent} />
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="mt-8 mb-3 flex items-center justify-between gap-4">
        <h2 className="text-xs font-semibold tracking-wide text-(--muted) uppercase">
          Files <span className="normal-case">({files.length})</span>
        </h2>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter files…"
          className="w-64 rounded-lg border border-(--border) bg-(--surface) px-3 py-1.5 text-[13px] outline-none placeholder:text-(--muted) focus:border-(--muted)"
        />
      </div>
      <Card className="px-1 pt-3 pb-1">
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
                <Td
                  className="max-w-64 truncate font-mono text-[12px] text-(--muted)"
                  // biome-ignore lint/a11y: title is supplementary
                >
                  <span title={f.missing}>{f.missing}</span>
                </Td>
                <Td className="text-right font-mono text-[12.5px] text-(--muted) tabular-nums">
                  {f.covered}/{f.total}
                </Td>
                <Td className="text-right">
                  <Pct percent={f.percent} />
                </Td>
                <Td className="w-28">
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
      </Card>

      <p className="mt-6 text-sm">
        <Link to={`/r/${repo}`} className="text-(--ink-2) hover:underline">
          ← Back to {repo}
        </Link>
      </p>
    </div>
  );
}
