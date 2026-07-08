import type { ReactNode } from "react";
import {
  type DirTrends,
  type PortfolioTrends,
  type RepoOverview,
  type ReportChanges,
  type Severity,
  type UploadRow,
  formatPercent,
  severity,
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
  return <p className="px-5 pb-4 text-sm text-(--muted)">{children}</p>;
}

/* ------------------------------------------------------------------ */
/* 1 · Risk quadrant — coverage vs. size, bubble = uncovered lines      */
/* ------------------------------------------------------------------ */

export function RiskQuadrant({ repos }: { repos: RepoOverview[] }) {
  const pts = repos
    .filter((r) => r.latest.linesTotal > 0)
    .map((r) => ({
      name: r.repo.split("/")[1] ?? r.repo,
      full: r.repo,
      kloc: r.latest.linesTotal / 1000,
      pct: r.latest.percent ?? 0,
      // Uncovered in thousands of lines — bubble area scales with that.
      uncovered: (r.latest.linesTotal - r.latest.linesCovered) / 1000,
    }));
  if (pts.length < 2) return <Empty>Two repositories with coverage will draw this. 🦘</Empty>;

  const W = 760;
  const H = 340;
  const L = 52;
  const R = 20;
  const T = 18;
  const B = 42;
  const maxK = Math.max(10, ...pts.map((p) => p.kloc)) * 1.12;
  const x = (k: number) => L + (k / maxK) * (W - L - R);
  const y = (p: number) => H - B - (p / 100) * (H - T - B);
  const rOf = (u: number) => Math.max(7, Math.min(46, Math.sqrt(u) * 7));
  const sizeMid = maxK * 0.42;

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
        const anchors: Array<{ lx: number; ly: number }> = [];
        return pts.map((d) => {
          const cx = x(d.kloc);
          const cy = y(d.pct);
          const r = rOf(d.uncovered);
          const left = cx > (L + W - R) / 2;
          const lx = left ? cx - r - 6 : cx + r + 6;
          let dy = 0;
          while (anchors.some((a) => Math.abs(a.lx - lx) < 70 && Math.abs(a.ly - (cy + dy)) < 15)) {
            dy += 17;
          }
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
    return <Empty>Coverage debt appears once there are a couple of days of uploads.</Empty>;
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
/* 4 · Commit waterfall — which upload moved coverage                   */
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

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      role="img"
      aria-label="covered lines by directory over time"
    >
      <title>Covered lines by top-level directory</title>
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
