import { useMemo, useState } from "react";
import { formatPercent, severity } from "../api.js";
import type { Child } from "./explorer.js";

/**
 * Squarified treemap: cell area = coverable lines, fill = coverage severity.
 * Shows where the *mass* of uncovered code lives — the thing tables can't.
 */

interface Cell {
  item: Child;
  x: number;
  y: number;
  w: number;
  h: number;
}

function squarify(items0: Child[], width: number, height: number): Cell[] {
  const total = items0.reduce((n, f) => n + f.total, 0);
  if (total === 0) return [];
  const scale = (width * height) / total;
  const items = items0.map((f) => ({ item: f, area: f.total * scale }));

  const cells: Cell[] = [];
  let x = 0;
  let y = 0;
  let w = width;
  let h = height;
  let row: typeof items = [];
  let i = 0;

  const worst = (r: typeof items, side: number): number => {
    const sum = r.reduce((n, it) => n + it.area, 0);
    let max = 0;
    for (const it of r) {
      const ratio = Math.max(
        (side * side * it.area) / (sum * sum),
        (sum * sum) / (side * side * it.area),
      );
      if (ratio > max) max = ratio;
    }
    return max;
  };

  const layoutRow = (r: typeof items) => {
    const sum = r.reduce((n, it) => n + it.area, 0);
    const horizontal = w >= h;
    const side = horizontal ? h : w;
    const thickness = sum / side;
    let offset = 0;
    for (const it of r) {
      const length = it.area / thickness;
      if (horizontal) {
        cells.push({ item: it.item, x, y: y + offset, w: thickness, h: length });
      } else {
        cells.push({ item: it.item, x: x + offset, y, w: length, h: thickness });
      }
      offset += length;
    }
    if (horizontal) {
      x += thickness;
      w -= thickness;
    } else {
      y += thickness;
      h -= thickness;
    }
  };

  while (i < items.length) {
    const side = Math.min(w, h);
    const candidate = [...row, items[i]!];
    if (row.length === 0 || worst(candidate, side) <= worst(row, side)) {
      row = candidate;
      i++;
    } else {
      layoutRow(row);
      row = [];
    }
  }
  if (row.length > 0) layoutRow(row);
  return cells;
}

const FILL: Record<string, string> = {
  good: "var(--good)",
  ok: "var(--ok)",
  warn: "var(--warn)",
  bad: "var(--bad)",
  muted: "var(--muted)",
};

export function Treemap({
  items,
  onNavigate,
}: {
  items: Child[];
  onNavigate: (path: string) => void;
}) {
  const W = 960;
  const H = 420;
  const [hover, setHover] = useState<Cell | null>(null);
  const cells = useMemo(
    () => squarify([...items].sort((a, b) => b.total - a.total).slice(0, 80), W, H),
    [items],
  );
  if (cells.length === 0) {
    return <p className="px-5 pb-4 text-sm text-(--muted)">Nothing coverable to map.</p>;
  }
  return (
    <div className="relative px-3 pb-3">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="coverage treemap">
        {cells.map((c) => {
          const name = c.item.isDir ? `${c.item.name}/` : c.item.name;
          const showLabel = c.w > 76 && c.h > 30;
          return (
            // biome-ignore lint/a11y/useKeyWithMouseEvents: hover detail is supplementary; keyboard path is the Explorer tab
            // biome-ignore lint/a11y/useKeyWithClickEvents: same navigation is keyboard-reachable via the Explorer tab
            <g
              key={c.item.path}
              onMouseEnter={() => setHover(c)}
              onMouseLeave={() => setHover(null)}
              onClick={() => c.item.isDir && onNavigate(c.item.path)}
              style={{ cursor: c.item.isDir ? "pointer" : "default" }}
            >
              <rect
                x={c.x + 1.5}
                y={c.y + 1.5}
                width={Math.max(0, c.w - 3)}
                height={Math.max(0, c.h - 3)}
                rx={5}
                fill={FILL[severity(c.item.percent)]}
                opacity={hover?.item.path === c.item.path ? 0.5 : 0.28}
                stroke={FILL[severity(c.item.percent)]}
                strokeOpacity={0.55}
              />
              {showLabel && (
                <>
                  <text
                    x={c.x + 9}
                    y={c.y + 17}
                    fontSize={10.5}
                    fontFamily="ui-monospace, Menlo, monospace"
                    fill="var(--ink)"
                  >
                    {name.length > c.w / 7 ? `${name.slice(0, Math.floor(c.w / 7))}…` : name}
                  </text>
                  <text
                    x={c.x + 9}
                    y={c.y + 31}
                    fontSize={10}
                    fill="var(--ink-2)"
                    className="tabular-nums"
                  >
                    {formatPercent(c.item.percent)}
                  </text>
                </>
              )}
            </g>
          );
        })}
      </svg>
      {hover && (
        <div className="pointer-events-none absolute top-3 left-1/2 z-10 -translate-x-1/2 rounded-lg border border-(--border) bg-(--surface) px-3 py-1.5 text-xs shadow-lg">
          <span className="font-mono">
            {hover.item.path}
            {hover.item.isDir ? "/" : ""}
          </span>
          <span className="mx-2 text-(--muted)">·</span>
          <span className="font-semibold tabular-nums">{formatPercent(hover.item.percent)}</span>
          <span className="ml-1.5 text-(--muted)">
            ({hover.item.covered.toLocaleString()}/{hover.item.total.toLocaleString()} lines
            {hover.item.isDir ? ` · ${hover.item.fileCount} files` : ""})
          </span>
        </div>
      )}
      <p className="mt-2 px-2 text-[11.5px] text-(--muted)">
        Cell size = coverable lines · color = coverage · click a directory to zoom in. Big warm
        cells are where tests pay off most.
      </p>
    </div>
  );
}
