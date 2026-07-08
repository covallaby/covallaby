import { useMemo, useState } from "react";
import { formatPercent, severity } from "../api.js";
import type { FileEntry } from "./tree.js";

/**
 * Squarified treemap: cell area = coverable lines, fill = coverage severity.
 * Shows where the *mass* of uncovered code lives — the thing tables can't.
 */

interface Cell {
  file: FileEntry;
  x: number;
  y: number;
  w: number;
  h: number;
}

function squarify(files: FileEntry[], width: number, height: number): Cell[] {
  const total = files.reduce((n, f) => n + f.total, 0);
  if (total === 0) return [];
  const scale = (width * height) / total;
  const items = files.map((f) => ({ file: f, area: f.total * scale }));

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
        cells.push({ file: it.file, x, y: y + offset, w: thickness, h: length });
      } else {
        cells.push({ file: it.file, x: x + offset, y, w: length, h: thickness });
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

export function Treemap({ files }: { files: FileEntry[] }) {
  const W = 960;
  const H = 420;
  const [hover, setHover] = useState<Cell | null>(null);
  const cells = useMemo(
    () => squarify([...files].sort((a, b) => b.total - a.total).slice(0, 120), W, H),
    [files],
  );
  if (cells.length === 0) {
    return <p className="px-5 pb-4 text-sm text-(--muted)">Nothing coverable to map.</p>;
  }
  return (
    <div className="relative px-3 pb-3">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="coverage treemap">
        {cells.map((c) => {
          const name = c.file.path.split("/").pop() ?? c.file.path;
          const showLabel = c.w > 76 && c.h > 30;
          return (
            // biome-ignore lint/a11y/useKeyWithMouseEvents: hover detail is supplementary; data is in the Files tab
            <g
              key={c.file.path}
              onMouseEnter={() => setHover(c)}
              onMouseLeave={() => setHover(null)}
            >
              <rect
                x={c.x + 1.5}
                y={c.y + 1.5}
                width={Math.max(0, c.w - 3)}
                height={Math.max(0, c.h - 3)}
                rx={5}
                fill={FILL[severity(c.file.percent)]}
                opacity={hover?.file.path === c.file.path ? 0.5 : 0.28}
                stroke={FILL[severity(c.file.percent)]}
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
                    {formatPercent(c.file.percent)}
                  </text>
                </>
              )}
            </g>
          );
        })}
      </svg>
      {hover && (
        <div className="pointer-events-none absolute top-3 left-1/2 z-10 -translate-x-1/2 rounded-lg border border-(--border) bg-(--surface) px-3 py-1.5 text-xs shadow-lg">
          <span className="font-mono">{hover.file.path}</span>
          <span className="mx-2 text-(--muted)">·</span>
          <span className="font-semibold tabular-nums">{formatPercent(hover.file.percent)}</span>
          <span className="ml-1.5 text-(--muted)">
            ({hover.file.covered}/{hover.file.total} lines)
          </span>
        </div>
      )}
      <p className="mt-2 px-2 text-[11.5px] text-(--muted)">
        Cell size = coverable lines · color = coverage. Big warm cells are where tests pay off most.
      </p>
    </div>
  );
}
