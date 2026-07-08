import { useMemo, useRef, useState } from "react";

/**
 * SVG charts per the dataviz method: 2px lines, token inks, ~10% area wash,
 * hairline solid gridlines, dots with a surface ring, crosshair + tooltip on
 * hover.
 */

export function Sparkline({
  points,
  width = 110,
  height = 36,
}: {
  points: Array<number | null>;
  width?: number;
  height?: number;
}) {
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
  const line = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const first = coords[0]!;
  const last = coords[coords.length - 1]!;
  return (
    <svg width={width} height={height} role="img" aria-label="coverage trend">
      <polygon
        points={`${first[0].toFixed(1)},${height - 1} ${line} ${last[0].toFixed(1)},${height - 1}`}
        fill="var(--series-wash)"
      />
      <polyline
        points={line}
        fill="none"
        stroke="var(--series)"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
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

const W = 940;
const H = 250;
const M = { top: 14, right: 18, bottom: 30, left: 46 };

export function HistoryChart({ points }: { points: TrendPoint[] }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const geom = useMemo(() => {
    const values = points.map((p) => p.percent).filter((p): p is number => p !== null);
    if (values.length < 2) return null;
    const yMin = Math.max(0, Math.floor((Math.min(...values) - 2) / 5) * 5);
    const yMax = Math.min(100, Math.ceil((Math.max(...values) + 2) / 5) * 5);
    const span = yMax - yMin || 1;
    const iw = W - M.left - M.right;
    const ih = H - M.top - M.bottom;
    const x = (i: number) => M.left + (points.length === 1 ? 0 : (i / (points.length - 1)) * iw);
    const y = (v: number) => M.top + ih - ((v - yMin) / span) * ih;
    const ticks: number[] = [];
    for (let t = yMin; t <= yMax; t += span > 20 ? 10 : 5) ticks.push(t);
    // Sparse x labels: aim for ~6, always include first and last.
    const every = Math.max(1, Math.ceil(points.length / 6));
    const xTicks = points
      .map((p, i) => ({ i, label: p.label }))
      .filter(({ i }) => i % every === 0 || i === points.length - 1);
    return { yMin, yMax, x, y, ticks, xTicks };
  }, [points]);

  if (!geom) {
    return (
      <p className="p-4 text-sm text-(--muted)">
        Not enough uploads yet to draw a trend — two will do it.
      </p>
    );
  }
  const { x, y, ticks, xTicks, yMin } = geom;

  const coords: Array<[number, number, number]> = [];
  points.forEach((p, i) => {
    if (p.percent !== null) coords.push([x(i), y(p.percent), i]);
  });
  const line = coords.map(([cx, cy]) => `${cx.toFixed(1)},${cy.toFixed(1)}`).join(" ");
  const baseline = y(yMin);

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
    <div ref={wrap} className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        style={{ maxWidth: W, display: "block", touchAction: "none" }}
        role="img"
        aria-label="coverage history"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
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
              x={M.left - 10}
              y={y(t) + 3.5}
              textAnchor="end"
              fill="var(--muted)"
              fontSize={11}
              className="tabular-nums"
            >
              {t}%
            </text>
          </g>
        ))}
        {xTicks.map(({ i, label }) => (
          <text
            key={`x-${i}`}
            x={x(i)}
            y={H - 8}
            textAnchor="middle"
            fill="var(--muted)"
            fontSize={10.5}
            fontFamily="ui-monospace, Menlo, monospace"
          >
            {label}
          </text>
        ))}
        <polygon
          points={`${coords[0]![0].toFixed(1)},${baseline.toFixed(1)} ${line} ${coords[coords.length - 1]![0].toFixed(1)},${baseline.toFixed(1)}`}
          fill="var(--series-wash)"
        />
        <polyline
          points={line}
          fill="none"
          stroke="var(--series)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {hovered && hovered.percent !== null && (
          <line
            x1={x(hovered.i)}
            x2={x(hovered.i)}
            y1={M.top}
            y2={H - M.bottom}
            stroke="var(--muted)"
            strokeWidth={1}
            strokeDasharray="none"
            opacity={0.5}
          />
        )}
        {points.map((p, i) =>
          p.percent === null ? null : (
            <circle
              key={`${p.label}-${i}`}
              cx={x(i)}
              cy={y(p.percent)}
              r={hover === i ? 5 : 3.5}
              fill="var(--series)"
              stroke="var(--surface)"
              strokeWidth={2}
            />
          ),
        )}
      </svg>
      {hovered && hovered.percent !== null && (
        <div
          className="pointer-events-none absolute top-2 z-10 rounded-lg border border-(--border) bg-(--surface) px-3 py-1.5 text-xs shadow-lg"
          style={{
            left: `${(x(hovered.i) / W) * 100}%`,
            transform: x(hovered.i) > W / 2 ? "translateX(-108%)" : "translateX(8%)",
          }}
        >
          <div className="font-mono text-(--ink-2)">{hovered.label}</div>
          {hovered.sublabel && <div className="text-(--muted)">{hovered.sublabel}</div>}
          <div className="mt-0.5 font-semibold tabular-nums">{hovered.percent.toFixed(1)}%</div>
        </div>
      )}
    </div>
  );
}
