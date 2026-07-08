import { useId, useMemo, useState } from "react";

/**
 * SVG charts: smooth monotone area with a gradient wash (shadcn/charts
 * style), token inks, sparse axes, crosshair + tooltip on hover.
 */

/** Catmull-Rom → cubic bezier path through the points (monotone-ish smooth). */
function smoothPath(pts: Array<[number, number]>): string {
  if (pts.length < 2) return "";
  const d: string[] = [`M ${pts[0]![0].toFixed(1)} ${pts[0]![1].toFixed(1)}`];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[Math.min(pts.length - 1, i + 2)]!;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d.push(
      `C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`,
    );
  }
  return d.join(" ");
}

export function Sparkline({
  points,
  width = 110,
  height = 36,
}: {
  points: Array<number | null>;
  width?: number;
  height?: number;
}) {
  const id = useId();
  const values = points.filter((p): p is number => p !== null);
  if (values.length < 2) return <svg width={width} height={height} aria-hidden="true" />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 4;
  const step = (width - pad * 2) / (points.length - 1);
  const coords: Array<[number, number]> = [];
  points.forEach((p, i) => {
    if (p !== null) {
      coords.push([pad + i * step, height - pad - ((p - min) / span) * (height - pad * 2)]);
    }
  });
  const path = smoothPath(coords);
  const first = coords[0]!;
  const last = coords[coords.length - 1]!;
  return (
    <svg width={width} height={height} role="img" aria-label="coverage trend">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--series)" stopOpacity="0.28" />
          <stop offset="100%" stopColor="var(--series)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d={`${path} L ${last[0].toFixed(1)} ${height - 1} L ${first[0].toFixed(1)} ${height - 1} Z`}
        fill={`url(#${id})`}
      />
      <path d={path} fill="none" stroke="var(--series)" strokeWidth={2} strokeLinecap="round" />
      <circle
        cx={last[0]}
        cy={last[1]}
        r={3.5}
        fill="var(--series)"
        stroke="var(--surface)"
        strokeWidth={2}
      />
    </svg>
  );
}

export interface TrendPoint {
  percent: number | null;
  label: string;
  sublabel?: string;
}

const W = 960;

export function HistoryChart({ points, height = 260 }: { points: TrendPoint[]; height?: number }) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const H = height;
  const M = { top: 16, right: 12, bottom: 26, left: 38 };

  const geom = useMemo(() => {
    const values = points.map((p) => p.percent).filter((p): p is number => p !== null);
    if (values.length < 2) return null;
    const yMin = Math.max(0, Math.floor((Math.min(...values) - 3) / 5) * 5);
    const yMax = Math.min(100, Math.ceil((Math.max(...values) + 3) / 5) * 5);
    const span = yMax - yMin || 1;
    const iw = W - M.left - M.right;
    const ih = H - M.top - M.bottom;
    const x = (i: number) => M.left + (points.length === 1 ? 0 : (i / (points.length - 1)) * iw);
    const y = (v: number) => M.top + ih - ((v - yMin) / span) * ih;
    const step = span > 25 ? 10 : 5;
    const ticks: number[] = [];
    for (let t = yMin + step; t <= yMax; t += step) ticks.push(t);
    const every = Math.max(1, Math.ceil(points.length / 6));
    const xTicks = points
      .map((p, i) => ({ i, label: p.label }))
      .filter(({ i }) => i % every === 0 || i === points.length - 1);
    return { x, y, ticks, xTicks, yMin };
  }, [points, H]);

  if (!geom) {
    return (
      <p className="px-5 pb-4 text-sm text-(--muted)">
        Not enough uploads yet to draw a trend — two will do it. 🦘
      </p>
    );
  }
  const { x, y, ticks, xTicks, yMin } = geom;

  const coords: Array<[number, number, number]> = [];
  points.forEach((p, i) => {
    if (p.percent !== null) coords.push([x(i), y(p.percent), i]);
  });
  const line = smoothPath(coords.map(([cx, cy]) => [cx, cy]));
  const baseline = y(yMin);
  const first = coords[0]!;
  const last = coords[coords.length - 1]!;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best: number | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const [cx, , i] of coords) {
      const d = Math.abs(cx - px);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    setHover(best);
  };

  const hovered = hover !== null && points[hover] ? { ...points[hover]!, i: hover } : null;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        style={{ display: "block", touchAction: "none" }}
        role="img"
        aria-label="coverage history"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--series)" stopOpacity="0.32" />
            <stop offset="100%" stopColor="var(--series)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={M.left}
              x2={W - M.right}
              y1={y(t)}
              y2={y(t)}
              stroke="var(--hairline)"
              strokeWidth={1}
            />
            <text
              x={M.left - 8}
              y={y(t) + 3.5}
              textAnchor="end"
              fill="var(--muted)"
              fontSize={10.5}
              className="tabular-nums"
            >
              {t}
            </text>
          </g>
        ))}
        {xTicks.map(({ i, label }) => (
          <text
            key={`x-${i}`}
            x={x(i)}
            y={H - 7}
            textAnchor={i === points.length - 1 ? "end" : "middle"}
            fill="var(--muted)"
            fontSize={10.5}
            fontFamily="ui-monospace, Menlo, monospace"
          >
            {label}
          </text>
        ))}
        <path
          d={`${line} L ${last[0].toFixed(1)} ${baseline.toFixed(1)} L ${first[0].toFixed(1)} ${baseline.toFixed(1)} Z`}
          fill={`url(#${id})`}
        />
        <path
          d={line}
          fill="none"
          stroke="var(--series)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {hovered && hovered.percent !== null && (
          <g>
            <line
              x1={x(hovered.i)}
              x2={x(hovered.i)}
              y1={M.top}
              y2={H - M.bottom}
              stroke="var(--muted)"
              strokeWidth={1}
              opacity={0.45}
            />
            <circle
              cx={x(hovered.i)}
              cy={y(hovered.percent)}
              r={4.5}
              fill="var(--series)"
              stroke="var(--surface)"
              strokeWidth={2}
            />
          </g>
        )}
      </svg>
      {hovered && hovered.percent !== null && (
        <div
          className="pointer-events-none absolute top-2 z-10 rounded-lg border border-(--border) bg-(--surface) px-3 py-1.5 text-xs shadow-lg"
          style={{
            left: `${(x(hovered.i) / W) * 100}%`,
            transform: x(hovered.i) > W / 2 ? "translateX(-108%)" : "translateX(10%)",
          }}
        >
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-[3px] bg-(--series)" />
            <span className="font-mono text-(--ink-2)">{hovered.label}</span>
          </div>
          {hovered.sublabel && <div className="mt-0.5 text-(--muted)">{hovered.sublabel}</div>}
          <div className="mt-0.5 font-semibold tabular-nums">{hovered.percent.toFixed(1)}%</div>
        </div>
      )}
    </div>
  );
}
