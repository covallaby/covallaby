import { historyChart, sparkline } from "./charts.js";
import { coverageClass, esc, layout, pct } from "./html.js";
import type { RepoOverview, UploadRow } from "./store.js";
import { formatPercent } from "./vendor/format.js";
import {
  type CoverageReport,
  formatRanges,
  rollupByDirectory,
  summarize,
  uncoveredRanges,
} from "./vendor/model.js";

const repoUrl = (repo: string) => `/r/${repo}`;
const when = (iso: string) => {
  const date = new Date(iso);
  return `<span title="${esc(iso)}">${esc(
    date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }),
  )}</span>`;
};

export function homePage(repos: RepoOverview[]): string {
  if (repos.length === 0) {
    return layout(
      "Getting started",
      "",
      `<div class="card">
<h2 style="margin-bottom:8px">No coverage yet — let's fix that</h2>
<p class="muted" style="margin-bottom:12px">Upload any coverage file (LCOV, JaCoCo, Cobertura, xccov) from CI or your machine:</p>
<pre class="mono" style="overflow-x:auto">curl -X POST "$SERVER/api/v1/upload?repo=you/app&amp;branch=main&amp;commit=$(git rev-parse HEAD)" \\
  -H "Authorization: Bearer $COVALLABY_TOKEN" \\
  --data-binary @coverage/lcov.info</pre>
<p class="muted" style="margin-top:12px">The upload token is printed in the server log on first boot (or set COVALLABY_TOKEN).</p>
</div>`,
    );
  }
  const rows = repos
    .map(
      (r) => `<tr>
<td><a class="mono" href="${repoUrl(r.repo)}">${esc(r.repo)}</a></td>
<td class="muted">${esc(r.latest.branch)}</td>
<td>${sparkline(r.trend)}</td>
<td class="num muted">${r.latest.linesCovered.toLocaleString()}/${r.latest.linesTotal.toLocaleString()}</td>
<td class="num">${pct(r.latest.percent)}</td>
</tr>`,
    )
    .join("\n");
  return layout(
    "Repositories",
    `${repos.length} ${repos.length === 1 ? "repository" : "repositories"}`,
    `<div class="card"><table>
<thead><tr><th>Repository</th><th>Branch</th><th>Trend</th><th class="num">Lines</th><th class="num">Coverage</th></tr></thead>
<tbody>${rows}</tbody></table></div>`,
  );
}

export function repoPage(
  repo: string,
  branch: string,
  branches: string[],
  history: UploadRow[],
): string {
  const pills = branches
    .slice(0, 8)
    .map(
      (b) =>
        `<a class="pill${b === branch ? " active" : ""}" href="${repoUrl(repo)}?branch=${encodeURIComponent(b)}">${esc(b)}</a>`,
    )
    .join("");
  const chartPoints = [...history]
    .reverse()
    .map((u) => ({ percent: u.percent, label: `${u.commit.slice(0, 7)}` }));
  const latest = history[0];
  const tiles = latest
    ? `<div class="tiles">
<div class="tile"><div class="label">Coverage</div><div class="value ${coverageClass(latest.percent)}">${formatPercent(latest.percent)}</div></div>
<div class="tile"><div class="label">Lines</div><div class="value">${latest.linesCovered.toLocaleString()}<span class="muted" style="font-size:15px">/${latest.linesTotal.toLocaleString()}</span></div></div>
<div class="tile"><div class="label">Files</div><div class="value">${latest.files}</div></div>
<div class="tile"><div class="label">Uploads</div><div class="value">${history.length}</div></div>
</div>`
    : "";
  const rows = history
    .map(
      (u) => `<tr>
<td><a class="mono" href="${repoUrl(repo)}/u/${u.id}">${esc(u.commit.slice(0, 10))}</a>${u.pr ? ` <span class="muted">#${u.pr}</span>` : ""}</td>
<td class="muted">${when(u.createdAt)}</td>
<td class="num muted">${u.linesCovered.toLocaleString()}/${u.linesTotal.toLocaleString()}</td>
<td class="num">${pct(u.percent)}</td>
</tr>`,
    )
    .join("\n");
  return layout(
    repo,
    `<a href="/">repos</a> / ${esc(repo)}`,
    `<div style="margin-bottom:16px">${pills}</div>
${tiles}
<div class="card">${historyChart(chartPoints)}</div>
<div class="card"><table>
<thead><tr><th>Commit</th><th>When</th><th class="num">Lines</th><th class="num">Coverage</th></tr></thead>
<tbody>${rows || '<tr><td colspan="4" class="muted">No uploads on this branch yet.</td></tr>'}</tbody></table></div>`,
  );
}

export function uploadPage(row: UploadRow, report: CoverageReport): string {
  const summary = summarize(report);
  const dirs = rollupByDirectory(summary);
  const dirRows = dirs
    .map(
      (d) => `<tr>
<td class="mono">${esc(d.path)}/</td>
<td class="num muted">${d.lines.covered.toLocaleString()}/${d.lines.total.toLocaleString()}</td>
<td class="num">${pct(d.lines.percent)}</td>
</tr>`,
    )
    .join("\n");
  const fileRows = [...summary.files]
    .sort((a, b) => (a.lines.percent ?? 101) - (b.lines.percent ?? 101))
    .map((f) => {
      const file = report.files.find((rf) => rf.path === f.path);
      const missing = file ? formatRanges(uncoveredRanges(file)) : "";
      return `<tr>
<td class="mono">${esc(f.path)}</td>
<td class="mono muted" style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(missing)}</td>
<td class="num muted">${f.lines.covered}/${f.lines.total}</td>
<td class="num">${pct(f.lines.percent)}</td>
</tr>`;
    })
    .join("\n");
  return layout(
    `${row.repo} @ ${row.commit.slice(0, 10)}`,
    `<a href="/">repos</a> / <a href="${repoUrl(row.repo)}">${esc(row.repo)}</a> / <span class="mono">${esc(row.commit.slice(0, 10))}</span>`,
    `<div class="tiles">
<div class="tile"><div class="label">Coverage</div><div class="value ${coverageClass(row.percent)}">${formatPercent(row.percent)}</div></div>
<div class="tile"><div class="label">Functions</div><div class="value">${formatPercent(summary.functions.percent)}</div></div>
<div class="tile"><div class="label">Branches</div><div class="value">${formatPercent(summary.branches.percent)}</div></div>
<div class="tile"><div class="label">Files</div><div class="value">${summary.totalFiles}</div></div>
</div>
<div class="card"><h2 style="font-size:15px;margin-bottom:10px">By directory</h2><table>
<thead><tr><th>Directory</th><th class="num">Lines</th><th class="num">Coverage</th></tr></thead>
<tbody>${dirRows}</tbody></table></div>
<div class="card"><h2 style="font-size:15px;margin-bottom:10px">Files</h2><table>
<thead><tr><th>File</th><th>Missing lines</th><th class="num">Lines</th><th class="num">Coverage</th></tr></thead>
<tbody>${fileRows}</tbody></table></div>`,
  );
}
