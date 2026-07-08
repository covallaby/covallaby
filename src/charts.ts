/**
 * Server-rendered SVG charts, following the dataviz method: 2px lines, token
 * inks (CSS variables from the page stylesheet), hairline solid gridlines,
 * ≥8px markers with a surface ring. No client JS.
 */

export interface TrendPoint {
  percent: number | null;
  label: string;
}

/** Tiny inline sparkline for repo lists. 12-ish points, no axes. */
export function sparkline(points: Array<number | null>, width = 120, height = 28): string {
  const values = points.filter((p): p is number => p !== null);
  if (values.length < 2) {
    return `<svg width="${width}" height="${height}" aria-hidden="true"></svg>`;
  }
  const min = Math.min(...values, 100);
  const max = Math.max(...values, 0);
  const span = max - min || 1;
  const pad = 3;
  const step = (width - pad * 2) / (points.length - 1);
  const coords = points
    .map((p, i) =>
      p === null
        ? null
        : `${(pad + i * step).toFixed(1)},${(height - pad - ((p - min) / span) * (height - pad * 2)).toFixed(1)}`,
    )
    .filter((c): c is string => c !== null);
  const last = coords[coords.length - 1]!.split(",");
  return `<svg width="${width}" height="${height}" role="img" aria-label="coverage trend">
  <polyline points="${coords.join(" ")}" fill="none" stroke="var(--series)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
  <circle cx="${last[0]}" cy="${last[1]}" r="3.5" fill="var(--series)" stroke="var(--surface)" stroke-width="2"/>
</svg>`;
}

/** The branch history line chart: coverage % over uploads. */
export function historyChart(points: TrendPoint[], width = 720, height = 220): string {
  const values = points.map((p) => p.percent).filter((p): p is number => p !== null);
  if (values.length < 2) {
    return `<p class="muted">Not enough uploads yet to draw a trend — two will do it.</p>`;
  }
  // Y domain: pad around observed values, clamp to [0, 100], round to 5s.
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const yMin = Math.max(0, Math.floor((rawMin - 2) / 5) * 5);
  const yMax = Math.min(100, Math.ceil((rawMax + 2) / 5) * 5);
  const span = yMax - yMin || 1;

  const m = { top: 12, right: 16, bottom: 24, left: 44 };
  const iw = width - m.left - m.right;
  const ih = height - m.top - m.bottom;
  const x = (i: number) => m.left + (points.length === 1 ? 0 : (i / (points.length - 1)) * iw);
  const y = (v: number) => m.top + ih - ((v - yMin) / span) * ih;

  const ticks: number[] = [];
  for (let t = yMin; t <= yMax; t += span > 20 ? 10 : 5) ticks.push(t);

  const grid = ticks
    .map(
      (t) =>
        `<line x1="${m.left}" x2="${width - m.right}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}" stroke="var(--hairline)" stroke-width="1"/>
<text x="${m.left - 8}" y="${(y(t) + 3.5).toFixed(1)}" text-anchor="end" class="tick">${t}%</text>`,
    )
    .join("\n");

  const line = points
    .map((p, i) => (p.percent === null ? null : `${x(i).toFixed(1)},${y(p.percent).toFixed(1)}`))
    .filter((c): c is string => c !== null)
    .join(" ");

  const dots = points
    .map((p, i) => {
      if (p.percent === null) return "";
      return `<circle cx="${x(i).toFixed(1)}" cy="${y(p.percent).toFixed(1)}" r="4" fill="var(--series)" stroke="var(--surface)" stroke-width="2"><title>${p.label}: ${p.percent.toFixed(1)}%</title></circle>`;
    })
    .join("\n");

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="coverage history" style="max-width:${width}px">
${grid}
<polyline points="${line}" fill="none" stroke="var(--series)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
${dots}
</svg>`;
}
