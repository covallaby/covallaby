import { type ReactNode, useMemo } from "react";
import {
  type DirTrends,
  type PortfolioTrends,
  type RepoOverview,
  type ReportChanges,
  type Severity,
  type UploadRow,
  formatPercent,
  severity,
  shortRepoName,
} from "../api.js";

/**
 * The insight charts — portfolio, per-repo, and per-PR views that go beyond a
 * table. All SVG, all theme tokens (so they follow light/dark for free), no
 * external deps. Data comes straight from the API; none of it needs source.
 */

const sevVar: Record<Severity, string> = {
  good: "var(--good)",
  ok: "var(--ok)",
  warn: "var(--warn)",
  bad: "var(--bad)",
  muted: "var(--muted)",
};
const sv = (p: number | null): string => sevVar[severity(p)];

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-5 pb-4 text-[13px] leading-relaxed text-(--muted)">{children}</p>;
}

/* ------------------------------------------------------------------ */
/* 1 · Risk quadrant — coverage vs. size, bubble = uncovered lines      */
/* ------------------------------------------------------------------ */

export function RiskQuadrant({ repos }: { repos: RepoOverview[] }) {
  const pts = repos
    .filter((r) => r.latest.linesTotal > 0)
    .map((r) => ({
      name: shortRepoName(r.repo),
      full: r.repo,
      kloc: r.latest.linesTotal / 1000,
      pct: r.latest.percent ?? 0,
      // Uncovered in thousands of lines — bubble area scales with that.
      uncovered: (r.latest.linesTotal - r.latest.linesCovered) / 1000,
    }));
  if (pts.length < 3)
    return (
      <Empty>
        Draws once <b className="font-medium text-(--ink-2)">3+ repositories</b> are uploading — you
        have {pts.length}. It'll appear here on its own. 🦘
      </Empty>
    );

  const W = 760;
  const H = 340;
  const L = 52;
  const R = 20;
  const T = 18;
  const B = 42;
  // Codebase size spans orders of magnitude (tiny SDKs → a big umbrella app),
  // so a linear x-axis crushes the small repos against the y-axis. A log scale
  // spreads them out and stops the one large repo from dominating the width.
  const ks = pts.map((p) => Math.max(p.kloc, 0.1));
  const kMin = Math.min(...ks);
  const kMax = Math.max(...ks);
  const lo = Math.log10(kMin) - 0.12;
  const hi = Math.log10(kMax) + 0.12;
  const span = hi - lo || 1;
  // Map log10(size) into the inner 5%–100% band (both edges get breathing room).
  const x = (k: number) =>
    L + (0.05 + ((Math.log10(Math.max(k, 0.1)) - lo) / span) * 0.95) * (W - L - R);
  const y = (p: number) => H - B - (p / 100) * (H - T - B);
  const rOf = (u: number) => Math.max(6, Math.min(32, Math.sqrt(u) * 6));
  // "Large codebase" boundary: the geometric mean of the sizes (the log midpoint).
  const sizeMid = Math.sqrt(kMin * kMax);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      role="img"
      aria-label="risk quadrant"
      className="overflow-visible"
    >
      <title>Coverage vs. codebase size</title>
      {/* danger zone: large and under-tested */}
      <rect
        x={x(sizeMid)}
        y={T}
        width={W - R - x(sizeMid)}
        height={y(75) - T}
        fill="var(--bad)"
        opacity={0.06}
      />
      <text
        x={W - R - 6}
        y={T + 14}
        textAnchor="end"
        fontSize={10}
        fontFamily="var(--font-mono)"
        fill="var(--bad)"
        opacity={0.75}
      >
        DANGER ZONE
      </text>
      {[0, 25, 50, 75, 100].map((p) => (
        <g key={p}>
          <line
            x1={L}
            x2={W - R}
            y1={y(p)}
            y2={y(p)}
            stroke="var(--hairline)"
            strokeDasharray={p === 75 ? "3 3" : undefined}
            opacity={p === 75 ? 0.9 : 0.5}
          />
          <text
            x={L - 8}
            y={y(p) + 3}
            textAnchor="end"
            fontSize={10}
            fontFamily="var(--font-mono)"
            fill="var(--muted)"
          >
            {p}
          </text>
        </g>
      ))}
      <line
        x1={x(sizeMid)}
        x2={x(sizeMid)}
        y1={T}
        y2={H - B}
        stroke="var(--hairline)"
        strokeDasharray="3 3"
        opacity={0.9}
      />
      <text x={(L + W - R) / 2} y={H - 6} textAnchor="middle" fontSize={10.5} fill="var(--ink-2)">
        codebase size → (thousands of lines)
      </text>
      <text
        x={13}
        y={(T + H - B) / 2}
        textAnchor="middle"
        fontSize={10.5}
        fill="var(--ink-2)"
        transform={`rotate(-90 13 ${(T + H - B) / 2})`}
      >
        coverage %
      </text>
      {(() => {
        // Lay out labels, nudging any that would collide with an earlier one.
        // Try small alternating offsets (down, then up) so labels fan out around
        // a cluster instead of all stacking downward onto other points.
        const anchors: Array<{ lx: number; ly: number }> = [];
        const offsets = [0, 18, -18, 34, -34, 50, -50, 66, -66];
        return pts.map((d) => {
          const cx = x(d.kloc);
          const cy = y(d.pct);
          const r = rOf(d.uncovered);
          const left = cx > (L + W - R) / 2;
          const lx = left ? cx - r - 6 : cx + r + 6;
          // Each label is two lines (~24px tall); clear that when they'd overlap.
          const dy =
            offsets.find(
              (o) =>
                !anchors.some((a) => Math.abs(a.lx - lx) < 78 && Math.abs(a.ly - (cy + o)) < 24),
            ) ?? 0;
          anchors.push({ lx, ly: cy + dy });
          return (
            <g key={d.full}>
              <circle cx={cx} cy={cy} r={r} fill={sv(d.pct)} opacity={0.22} />
              <circle cx={cx} cy={cy} r={r} fill="none" stroke={sv(d.pct)} strokeWidth={1.6} />
              <circle cx={cx} cy={cy} r={2.2} fill={sv(d.pct)} />
              <text
                x={lx}
                y={cy - 1 + dy}
                textAnchor={left ? "end" : "start"}
                fontSize={11}
                fontWeight={600}
                fill="var(--ink)"
              >
                {d.name}
              </text>
              <text
                x={lx}
                y={cy + 11 + dy}
                textAnchor={left ? "end" : "start"}
                fontSize={10}
                fontFamily="var(--font-mono)"
                fill="var(--muted)"
              >
                {formatPercent(d.pct)}
              </text>
            </g>
          );
        });
      })()}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* 3 · Coverage debt over time — covered vs. uncovered, whole portfolio */
/* ------------------------------------------------------------------ */

export function CoverageDebt({ trends }: { trends: PortfolioTrends }) {
  const s = trends.series;
  if (s.length < 2)
    return (
      <Empty>
        Fills in after a <b className="font-medium text-(--ink-2)">couple of days of uploads</b>,
        once there's a trend to plot. 🦘
      </Empty>
    );
  const W = 720;
  const H = 220;
  const L = 44;
  const Rp = 12;
  const T = 14;
  const B = 24;
  const max = Math.max(...s.map((p) => p.total)) * 1.04 || 1;
  const x = (i: number) => L + (i / (s.length - 1)) * (W - L - Rp);
  const y = (v: number) => H - B - (v / max) * (H - T - B);
  const covLine = s
    .map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.covered).toFixed(1)}`)
    .join(" ");
  const totLine = s
    .map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.total).toFixed(1)}`)
    .join(" ");
  const band = `${totLine} ${[...s]
    .map((p, i) => [p, i] as const)
    .reverse()
    .map(([p, i]) => `L${x(i).toFixed(1)} ${y(p.covered).toFixed(1)}`)
    .join(" ")} Z`;
  const covArea = `M${x(0).toFixed(1)} ${y(0)} ${covLine.slice(1)} L${x(s.length - 1).toFixed(1)} ${y(0)} Z`;
  const fmtK = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`);
  const fmtDay = (t: number) =>
    new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="coverage debt over time">
      <title>Covered vs. uncovered lines over time</title>
      {[0, 0.5, 1].map((f) => (
        <line
          key={f}
          x1={L}
          x2={W - Rp}
          y1={y(max * f)}
          y2={y(max * f)}
          stroke="var(--hairline)"
          opacity={0.5}
        />
      ))}
      {[0, 0.5, 1].map((f) => (
        <text
          key={f}
          x={L - 6}
          y={y(max * f) + 3}
          textAnchor="end"
          fontSize={10}
          fontFamily="var(--font-mono)"
          fill="var(--muted)"
        >
          {fmtK(max * f)}
        </text>
      ))}
      <path d={band} fill="var(--bad)" opacity={0.16} />
      <path d={covArea} fill="var(--good)" opacity={0.2} />
      <path d={covLine} fill="none" stroke="var(--good)" strokeWidth={2} strokeLinejoin="round" />
      <path
        d={totLine}
        fill="none"
        stroke="var(--bad)"
        strokeWidth={1.4}
        strokeDasharray="3 3"
        opacity={0.7}
      />
      {s.map((p, i) =>
        i % Math.ceil(s.length / 6) === 0 ? (
          <text
            key={p.t}
            x={x(i)}
            y={H - 6}
            textAnchor="middle"
            fontSize={10}
            fontFamily="var(--font-mono)"
            fill="var(--muted)"
          >
            {fmtDay(p.t)}
          </text>
        ) : null,
      )}
      <rect x={L + 2} y={T} width={9} height={9} rx={2} fill="var(--good)" opacity={0.5} />
      <text x={L + 15} y={T + 8} fontSize={10} fontFamily="var(--font-mono)" fill="var(--muted)">
        covered
      </text>
      <rect x={L + 66} y={T} width={9} height={9} rx={2} fill="var(--bad)" opacity={0.45} />
      <text x={L + 79} y={T + 8} fontSize={10} fontFamily="var(--font-mono)" fill="var(--muted)">
        total
      </text>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* 6 · Directory streamgraph — covered lines by top folder over time    */
/* ------------------------------------------------------------------ */

const STREAM_COLORS = [
  "var(--series)",
  "var(--accent)",
  "var(--warn)",
  "var(--ok)",
  "var(--muted)",
  "var(--bad)",
];

export function DirectoryStream({ data }: { data: DirTrends }) {
  const steps = data.steps.length;
  if (steps < 2 || data.dirs.length === 0)
    return <Empty>A few uploads on this branch draw the per-folder breakdown. 🦘</Empty>;
  const W = 720;
  const H = 220;
  const L = 40;
  const Rp = 92;
  const T = 10;
  const B = 22;
  const totals = Array.from({ length: steps }, (_, i) =>
    data.dirs.reduce((s, d) => s + (d.values[i] ?? 0), 0),
  );
  const max = Math.max(1, ...totals) * 1.02;
  const x = (i: number) => L + (i / (steps - 1)) * (W - L - Rp);
  const y = (v: number) => H - B - (v / max) * (H - T - B);
  const baseline = new Array(steps).fill(0);
  const bands = data.dirs.map((d, di) => {
    const top = d.values.map((v, i) => y(baseline[i] + (v ?? 0)));
    const path = `${d.values.map((_, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${top[i]!.toFixed(1)}`).join(" ")} ${[
      ...Array(steps).keys(),
    ]
      .reverse()
      .map((i) => `L${x(i).toFixed(1)} ${y(baseline[i]).toFixed(1)}`)
      .join(" ")} Z`;
    const labelMid = baseline[steps - 1] + (d.values[steps - 1] ?? 0) / 2;
    for (let i = 0; i < steps; i++) baseline[i] += d.values[i] ?? 0;
    return {
      path,
      color: STREAM_COLORS[di % STREAM_COLORS.length]!,
      dir: d.dir,
      labelY: y(labelMid),
    };
  });

  const fmtK = (v: number) =>
    v >= 1000 ? `${(v / 1000).toFixed(v >= 10_000 ? 0 : 1)}k` : `${Math.round(v)}`;
  const fmtDay = (t: number) =>
    Number.isFinite(t)
      ? new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" })
      : "";
  const xEvery = Math.max(1, Math.ceil(steps / 6));

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      role="img"
      aria-label="covered lines by directory over time"
    >
      <title>Covered lines by top-level directory</title>
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line
            x1={L}
            x2={W - Rp}
            y1={y(max * f)}
            y2={y(max * f)}
            stroke="var(--hairline)"
            opacity={0.5}
          />
          <text
            x={L - 6}
            y={y(max * f) + 3}
            textAnchor="end"
            fontSize={9.5}
            fontFamily="var(--font-mono)"
            fill="var(--muted)"
          >
            {fmtK(max * f)}
          </text>
        </g>
      ))}
      {bands.map((b) => (
        <path
          key={b.dir}
          d={b.path}
          fill={b.color}
          opacity={0.55}
          stroke="var(--surface)"
          strokeWidth={0.6}
        />
      ))}
      {data.steps.map((s, i) =>
        i % xEvery === 0 ? (
          <text
            key={s.commit}
            x={x(i)}
            y={H - 6}
            textAnchor="middle"
            fontSize={9.5}
            fontFamily="var(--font-mono)"
            fill="var(--muted)"
          >
            {fmtDay(s.t)}
          </text>
        ) : null,
      )}
      {bands.map((b) => (
        <text
          key={`l-${b.dir}`}
          x={W - Rp + 6}
          y={b.labelY + 3}
          fontSize={10}
          fontFamily="var(--font-mono)"
          fontWeight={600}
          fill={b.color}
        >
          {b.dir}/
        </text>
      ))}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* 7 · Patch treemap — did the new & changed code get tested?           */
/* ------------------------------------------------------------------ */

interface Tile {
  name: string;
  path: string;
  size: number;
  pct: number | null;
  x: number;
  y: number;
  w: number;
  h: number;
}

function sliceDice(
  items: Array<{ name: string; path: string; size: number; pct: number | null }>,
): Tile[] {
  const W = 720;
  const H = 240;
  const out: Tile[] = [];
  const place = (arr: typeof items, X: number, Y: number, Wd: number, Ht: number) => {
    if (arr.length === 0) return;
    if (arr.length === 1) {
      const a = arr[0]!;
      out.push({ ...a, x: X, y: Y, w: Wd, h: Ht });
      return;
    }
    const tot = arr.reduce((s, a) => s + a.size, 0) || 1;
    let acc = 0;
    let idx = 0;
    for (; idx < arr.length - 1; idx++) {
      if (acc + arr[idx]!.size > tot / 2) break;
      acc += arr[idx]!.size;
    }
    const g1 = arr.slice(0, idx + 1);
    const g2 = arr.slice(idx + 1);
    const f1 = g1.reduce((s, a) => s + a.size, 0) / tot;
    if (Wd >= Ht) {
      place(g1, X, Y, Wd * f1, Ht);
      place(g2, X + Wd * f1, Y, Wd * (1 - f1), Ht);
    } else {
      place(g1, X, Y, Wd, Ht * f1);
      place(g2, X, Y + Ht * f1, Wd, Ht * (1 - f1));
    }
  };
  place(
    [...items].sort((a, b) => b.size - a.size),
    0,
    0,
    W,
    H,
  );
  return out;
}

export function PatchTreemap({ changes }: { changes: ReportChanges }) {
  const items = [
    ...changes.added.map((f) => ({
      name: f.path.split("/").pop() ?? f.path,
      path: f.path,
      size: Math.max(6, f.total),
      pct: f.percent,
    })),
    ...changes.changed.map((f) => ({
      name: f.path.split("/").pop() ?? f.path,
      path: f.path,
      size: Math.max(12, Math.abs(f.delta) * 6),
      pct: f.after,
    })),
  ];
  if (items.length === 0) return <Empty>No files added or changed — nothing to map.</Empty>;
  const tiles = sliceDice(items);
  const W = 720;
  const H = 240;
  const g = 1.5;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="changed files by coverage">
      <title>New and changed files, sized by impact, colored by coverage</title>
      {tiles.map((t) => (
        <g key={t.path}>
          <rect
            x={t.x + g}
            y={t.y + g}
            width={Math.max(0, t.w - g * 2)}
            height={Math.max(0, t.h - g * 2)}
            rx={4}
            fill={sv(t.pct)}
            opacity={0.82}
          >
            <title>{`${t.path} · ${formatPercent(t.pct)}`}</title>
          </rect>
          {t.w > 58 && t.h > 26 && (
            <>
              <text x={t.x + 8} y={t.y + 17} fontSize={11} fontWeight={600} fill="#fff">
                {t.name}
              </text>
              <text
                x={t.x + 8}
                y={t.y + 31}
                fontSize={10}
                fontFamily="var(--font-mono)"
                fill="#fff"
                opacity={0.9}
              >
                {formatPercent(t.pct)}
              </text>
            </>
          )}
        </g>
      ))}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* 8 · Coverage barcode — the shape of the gap, line by line            */
/* ------------------------------------------------------------------ */

const TICK: Record<string, string> = { "2": "var(--good)", "1": "var(--warn)", "0": "var(--bad)" };

export function CoverageBarcode({
  files,
  limit = 8,
}: {
  files: Array<{ path: string; percent: number | null; cov: string }>;
  limit?: number;
}) {
  const shown = files.filter((f) => f.cov.length > 0).slice(0, limit);
  if (shown.length === 0) return <Empty>No per-line data in this upload.</Empty>;
  return (
    <div className="space-y-3.5">
      {shown.map((f) => {
        const dir = f.path.slice(0, f.path.lastIndexOf("/") + 1);
        const base = f.path.slice(f.path.lastIndexOf("/") + 1);
        // Downsample very long files so each tick stays ≥2px wide.
        const ticks = f.cov.length > 240 ? sample(f.cov, 240) : f.cov;
        return (
          <div key={f.path}>
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate font-mono text-[12px]">
                <span className="text-(--muted)">{dir}</span>
                {base}
              </span>
              <span
                className="font-mono text-[12px] font-semibold tabular-nums"
                style={{ color: sv(f.percent) }}
              >
                {formatPercent(f.percent)}
              </span>
            </div>
            <div className="flex h-[30px] items-stretch gap-[1.5px]">
              {ticks.split("").map((ch, i) => (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: fixed-order tick strip, index is the identity
                  key={i}
                  className="min-w-[2px] flex-auto rounded-[1.5px]"
                  style={{
                    background: TICK[ch] ?? "var(--surface-2)",
                    opacity: ch === "2" ? 0.9 : 1,
                  }}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Nearest-neighbour downsample of a coverage string, keeping the worst state in each bucket. */
function sample(cov: string, n: number): string {
  const rank: Record<string, number> = { "0": 0, "1": 1, "2": 2 };
  let out = "";
  for (let i = 0; i < n; i++) {
    const a = Math.floor((i / n) * cov.length);
    const b = Math.max(a + 1, Math.floor(((i + 1) / n) * cov.length));
    let worst = "2";
    for (let j = a; j < b && j < cov.length; j++) {
      if ((rank[cov[j]!] ?? 2) < (rank[worst] ?? 2)) worst = cov[j]!;
    }
    out += worst;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Commit waterfall — which upload moved coverage                       */
/* ------------------------------------------------------------------ */

export function CommitWaterfall({
  history,
  onPick,
}: {
  history: UploadRow[];
  onPick?: (id: number) => void;
}) {
  const seq = [...history].reverse().slice(-24); // oldest → newest, capped
  const bars = seq
    .map((u, j) => {
      const prev = seq[j - 1];
      const d = u.percent !== null && prev?.percent != null ? u.percent - prev.percent : null;
      return { u, d };
    })
    .filter((b): b is { u: UploadRow; d: number } => b.d !== null);
  if (bars.length < 1) return <Empty>Two uploads and the per-commit swing shows up here. 🦘</Empty>;

  const W = 760;
  const H = 250;
  const L = 30;
  const Rp = 14;
  const T = 22;
  const B = 40;
  const n = bars.length;
  const slot = (W - L - Rp) / n;
  const bw = Math.min(30, slot * 0.62);
  const maxAbs = Math.max(1, ...bars.map((b) => Math.abs(b.d)));
  const mid = (T + H - B) / 2;
  const sh = (v: number) => (v / maxAbs) * ((H - T - B) / 2);
  const grid = [maxAbs, maxAbs / 2, 0, -maxAbs / 2, -maxAbs].map((g) => Math.round(g * 10) / 10);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      role="img"
      aria-label="per-commit coverage change"
      className="overflow-visible"
    >
      <title>Coverage change per upload</title>
      {grid.map((g) => (
        <g key={g}>
          <line
            x1={L}
            x2={W - Rp}
            y1={mid - sh(g)}
            y2={mid - sh(g)}
            stroke="var(--hairline)"
            strokeDasharray={g === 0 ? undefined : "2 3"}
            opacity={g === 0 ? 1 : 0.4}
          />
          <text
            x={L - 5}
            y={mid - sh(g) + 3}
            textAnchor="end"
            fontSize={9.5}
            fontFamily="var(--font-mono)"
            fill="var(--muted)"
          >
            {g > 0 ? "+" : ""}
            {g}
          </text>
        </g>
      ))}
      {bars.map((b, i) => {
        const cx = L + slot * i + slot / 2;
        const up = b.d >= 0;
        const bh = Math.max(1.5, Math.abs(sh(b.d)));
        const by = up ? mid - bh : mid;
        return (
          // biome-ignore lint/a11y/useKeyWithClickEvents: the commit is reachable via the uploads table; this bar is a mouse shortcut
          <g
            key={b.u.id}
            onClick={onPick ? () => onPick(b.u.id) : undefined}
            style={{ cursor: onPick ? "pointer" : "default" }}
          >
            {onPick && (
              <rect x={cx - slot / 2} y={T} width={slot} height={H - T - B} fill="transparent" />
            )}
            <rect
              x={cx - bw / 2}
              y={by}
              width={bw}
              height={bh}
              rx={2}
              fill={up ? "var(--good)" : "var(--bad)"}
              opacity={0.9}
            />
            <text
              x={cx}
              y={up ? by - 4 : by + bh + 11}
              textAnchor="middle"
              fontSize={9.5}
              fontFamily="var(--font-mono)"
              fill={up ? "var(--good)" : "var(--bad)"}
            >
              {up ? "+" : ""}
              {b.d.toFixed(1)}
            </text>
            <text
              x={cx}
              y={H - 6}
              textAnchor="middle"
              fontSize={9.5}
              fontFamily="var(--font-mono)"
              fill="var(--muted)"
              opacity={0.85}
            >
              {b.u.commit.slice(0, 6)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Coverage calendar — a contribution grid of daily coverage            */
/* ------------------------------------------------------------------ */

export function CoverageCalendar({ history }: { history: UploadRow[] }) {
  const cells = useMemo(() => {
    const DAY = 86_400_000;
    const byDay = new Map<number, number>(); // day → last percent that day
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const u of history) {
      if (u.percent === null) continue;
      const t = new Date(u.createdAt).getTime();
      if (!Number.isFinite(t)) continue;
      const day = Math.floor(t / DAY);
      byDay.set(day, u.percent); // history is newest-first; last write = oldest of the day, close enough
      min = Math.min(min, day);
      max = Math.max(max, day);
    }
    if (!Number.isFinite(min)) return null;
    const end = max;
    const start = Math.min(min, end - 7 * 25); // ~26 weeks window at most
    const startAligned = start - (((start % 7) + 7) % 7 || 0); // snap to a week boundary
    const out: Array<{ day: number; pct: number | null }> = [];
    for (let d = startAligned; d <= end; d++) out.push({ day: d, pct: byDay.get(d) ?? null });
    return out;
  }, [history]);

  if (!cells) return <Empty>Uploads over a few days fill this calendar in. 🦘</Empty>;

  return (
    <div className="overflow-x-auto">
      <div className="grid grid-flow-col grid-rows-7 gap-[3px]">
        {cells.map((c) => {
          const op = c.pct === null ? 1 : 0.35 + Math.min(1, Math.abs(c.pct - 60) / 40) * 0.55;
          return (
            <div
              key={c.day}
              className="aspect-square w-full rounded-[3px]"
              style={{ background: c.pct === null ? "var(--surface-2)" : sv(c.pct), opacity: op }}
              title={c.pct === null ? undefined : `${formatPercent(c.pct)}`}
            />
          );
        })}
      </div>
      <div className="mt-3 flex items-center gap-1.5 text-[11px] text-(--muted)">
        Lower
        <span className="h-3 w-3 rounded-[3px]" style={{ background: "var(--bad)" }} />
        <span className="h-3 w-3 rounded-[3px]" style={{ background: "var(--warn)" }} />
        <span className="h-3 w-3 rounded-[3px]" style={{ background: "var(--ok)" }} />
        <span className="h-3 w-3 rounded-[3px]" style={{ background: "var(--good)" }} />
        Higher
      </div>
    </div>
  );
}
