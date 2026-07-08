import { formatPercent } from "./vendor/format.js";

export function esc(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Coverage severity, mirroring the badge scale. */
export function coverageClass(percent: number | null): string {
  if (percent === null) return "muted";
  if (percent >= 90) return "good";
  if (percent >= 75) return "ok";
  if (percent >= 60) return "warn";
  return "bad";
}

export function pct(percent: number | null): string {
  return `<span class="pct ${coverageClass(percent)}">${formatPercent(percent)}</span>`;
}

/** Design tokens from the validated reference palette; light + dark. */
const STYLE = `
:root {
  --page:#f9f9f7; --surface:#fcfcfb; --ink:#0b0b0b; --ink-2:#52514e;
  --muted:#898781; --hairline:#e1e0d9; --border:rgba(11,11,11,.1);
  --series:#2a78d6; --good:#0ca30c; --ok:#7a9c00; --warn:#c77d00; --bad:#d03b3b;
}
@media (prefers-color-scheme: dark) {
  :root {
    --page:#0d0d0d; --surface:#1a1a19; --ink:#fff; --ink-2:#c3c2b7;
    --muted:#898781; --hairline:#2c2c2a; --border:rgba(255,255,255,.1);
    --series:#3987e5; --good:#0ca30c; --ok:#a3b330; --warn:#d29922; --bad:#e66767;
  }
}
* { box-sizing:border-box; margin:0 }
body { background:var(--page); color:var(--ink);
  font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif; }
a { color:inherit; text-decoration:none } a:hover { text-decoration:underline }
main { max-width:960px; margin:0 auto; padding:32px 24px }
header.site { display:flex; align-items:baseline; gap:12px; margin-bottom:28px }
header.site h1 { font-size:20px } header.site .crumb { color:var(--ink-2) }
.card { background:var(--surface); border:1px solid var(--border); border-radius:12px;
  padding:20px; margin-bottom:20px }
table { width:100%; border-collapse:collapse; font-size:14px }
th { text-align:left; color:var(--muted); font-weight:500; padding:6px 10px;
  border-bottom:1px solid var(--hairline) }
td { padding:8px 10px; border-bottom:1px solid var(--hairline) }
tr:last-child td { border-bottom:none }
td.num, th.num { text-align:right; font-variant-numeric:tabular-nums }
.pct { font-variant-numeric:tabular-nums }
.good{color:var(--good)} .ok{color:var(--ok)} .warn{color:var(--warn)} .bad{color:var(--bad)}
.muted { color:var(--muted) }
.mono { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:13px }
.tiles { display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:14px;
  margin-bottom:20px }
.tile { background:var(--surface); border:1px solid var(--border); border-radius:12px;
  padding:14px 16px }
.tile .label { font-size:13px; color:var(--ink-2) }
.tile .value { font-size:26px; font-weight:600; margin-top:2px }
.tick { fill:var(--muted); font-size:11px }
.pill { display:inline-block; border:1px solid var(--border); border-radius:999px;
  padding:2px 10px; font-size:13px; color:var(--ink-2); margin-right:6px }
.pill.active { background:var(--hairline); color:var(--ink); font-weight:500 }
footer { margin-top:32px; padding-top:14px; border-top:1px solid var(--hairline);
  color:var(--muted); font-size:13px }
`;

export function layout(title: string, crumbs: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Covallaby</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<header class="site"><h1><a href="/">🦘 Covallaby</a></h1><span class="crumb">${crumbs}</span></header>
${body}
<footer>Covallaby server — beautiful coverage reports for your pull requests.</footer>
</main>
</body>
</html>`;
}
