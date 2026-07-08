import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { type UploadDetail, api, formatPercent, severity } from "../api.js";
import { Card, Meter, Pct, SectionTitle, Stat, Td, Th, inkFor } from "../components/ui.js";

export function Upload() {
  const { owner, name, id } = useParams();
  const repo = `${owner}/${name}`;
  const [data, setData] = useState<UploadDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .upload(id!)
      .then(setData)
      .catch((e) => setError(String(e)));
  }, [id]);

  if (error) return <p className="text-sm text-(--bad)">{error}</p>;
  if (!data) return null;

  const { row, totals } = data;

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
          <Stat value={formatPercent(totals.functions.percent)} label="functions" />
          <Stat value={formatPercent(totals.branches.percent)} label="branches" />
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

      <SectionTitle>Files</SectionTitle>
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
            {data.files.map((f) => (
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
