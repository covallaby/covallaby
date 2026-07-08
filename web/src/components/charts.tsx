/**
 * SVG charts per the dataviz method: 2px lines, token inks, ~10% area wash,
 * hairline solid gridlines, dots with a surface ring.
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
}

export function HistoryChart({ points }: { points: TrendPoint[] }) {
  const width = 940;
  const height = 240;
  const values = points.map((p) => p.percent).filter((p): p is number => p !== null);
  if (values.length < 2) {
    return (
      <p className="p-4 text-sm text-(--muted)">
        Not enough uploads yet to draw a trend — two will do it.
      </p>
    );
  }
  const yMin = Math.max(0, Math.floor((Math.min(...values) - 2) / 5) * 5);
  const yMax = Math.min(100, Math.ceil((Math.max(...values) + 2) / 5) * 5);
  const span = yMax - yMin || 1;
  const m = { top: 14, right: 18, bottom: 14, left: 46 };
  const iw = width - m.left - m.right;
  const ih = height - m.top - m.bottom;
  const x = (i: number) => m.left + (points.length === 1 ? 0 : (i / (points.length - 1)) * iw);
  const y = (v: number) => m.top + ih - ((v - yMin) / span) * ih;

  const ticks: number[] = [];
  for (let t = yMin; t <= yMax; t += span > 20 ? 10 : 5) ticks.push(t);

  const coords: Array<[number, number]> = [];
  points.forEach((p, i) => {
    if (p.percent !== null) coords.push([x(i), y(p.percent)]);
  });
  const line = coords.map(([cx, cy]) => `${cx.toFixed(1)},${cy.toFixed(1)}`).join(" ");
  const baseline = y(yMin);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      style={{ maxWidth: width, display: "block" }}
      role="img"
      aria-label="coverage history"
    >
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={m.left}
            x2={width - m.right}
            y1={y(t)}
            y2={y(t)}
            stroke="var(--hairline)"
            strokeWidth={1}
          />
          <text
            x={m.left - 10}
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
      {points.map((p, i) =>
        p.percent === null ? null : (
          <circle
            key={`${p.label}-${i}`}
            cx={x(i)}
            cy={y(p.percent)}
            r={4}
            fill="var(--series)"
            stroke="var(--surface)"
            strokeWidth={2}
          >
            <title>{`${p.label}: ${p.percent.toFixed(1)}%`}</title>
          </circle>
        ),
      )}
    </svg>
  );
}
