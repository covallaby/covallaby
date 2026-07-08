import { useMemo, useState } from "react";
import { formatPercent, severity } from "../api.js";
import type { TreeNode } from "./explorer.js";

/**
 * Nested squarified treemap: the whole tree at once. Top-level children of
 * the current node are labeled regions; their children pack inside. Cell
 * area = coverable lines, color = severity. Click a region to zoom.
 */

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function squarify(nodes: TreeNode[], rect: Rect): Array<{ node: TreeNode } & Rect> {
  const total = nodes.reduce((n, f) => n + f.total, 0);
  if (total === 0 || rect.w <= 0 || rect.h <= 0) return [];
  const scale = (rect.w * rect.h) / total;
  const items = nodes.filter((n) => n.total > 0).map((n) => ({ node: n, area: n.total * scale }));

  const cells: Array<{ node: TreeNode } & Rect> = [];
  let { x, y, w, h } = rect;
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
    // Float drift can shrink the remaining side to ~0 with items still queued;
    // clamp so thickness/length stay finite instead of producing Infinity rects.
    const side = Math.max(horizontal ? h : w, 1e-6);
    const thickness = sum / side;
    let offset = 0;
    for (const it of r) {
      const length = it.area / thickness;
      if (horizontal) cells.push({ node: it.node, x, y: y + offset, w: thickness, h: length });
      else cells.push({ node: it.node, x: x + offset, y, w: length, h: thickness });
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

export function findNode(root: TreeNode, path: string): TreeNode {
  if (path === "") return root;
  let node = root;
  for (;;) {
    const next = node.children.find(
      (c) =>
        path === c.path ||
        path.startsWith(`${c.path}/`) ||
        // Target is an interior segment of a collapsed chain (e.g. "src/main"
        // when the tree node is "src/main/java"): land on that node.
        c.path.startsWith(`${path}/`),
    );
    if (!next) return node;
    node = next;
    if (node.path === path || node.path.startsWith(`${path}/`)) return node;
  }
}

export function Treemap({
  root,
  path,
  onNavigate,
}: {
  root: TreeNode;
  path: string;
  onNavigate: (path: string) => void;
}) {
  const W = 960;
  const H = 480;
  const PAD = 4;
  const LABEL = 20;
  const [hover, setHover] = useState<{ node: TreeNode; region: TreeNode } | null>(null);

  const current = useMemo(() => findNode(root, path), [root, path]);
  const regions = useMemo(() => squarify(current.children, { x: 0, y: 0, w: W, h: H }), [current]);

  if (regions.length === 0) {
    return <p className="px-5 pb-4 text-sm text-(--muted)">Nothing coverable to map.</p>;
  }

  return (
    <div className="relative px-3 pb-3">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="coverage treemap">
        {regions.map((region) => {
          const isDir = region.node.file === null;
          const percent =
            region.node.total === 0 ? null : (region.node.covered / region.node.total) * 100;
          const inner: Rect = {
            x: region.x + PAD,
            y: region.y + PAD + (isDir ? LABEL : 0),
            w: region.w - PAD * 2,
            h: region.h - PAD * 2 - (isDir ? LABEL : 0),
          };
          const showChildren = isDir && region.w > 90 && region.h > 64;
          const kids = showChildren ? squarify(region.node.children, inner) : [];
          return (
            // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard path is the Tree tab
            // biome-ignore lint/a11y/useKeyWithMouseEvents: hover detail is supplementary
            <g
              key={region.node.path}
              onClick={() => isDir && onNavigate(region.node.path)}
              onMouseEnter={() => setHover({ node: region.node, region: region.node })}
              onMouseLeave={() => setHover(null)}
              style={{ cursor: isDir ? "pointer" : "default" }}
            >
              <rect
                x={region.x + 1.5}
                y={region.y + 1.5}
                width={Math.max(0, region.w - 3)}
                height={Math.max(0, region.h - 3)}
                rx={6}
                fill={FILL[severity(percent)]}
                opacity={hover?.region.path === region.node.path ? 0.3 : 0.16}
                stroke={
                  hover?.region.path === region.node.path ? "var(--ink)" : FILL[severity(percent)]
                }
                strokeOpacity={hover?.region.path === region.node.path ? 0.35 : 0.5}
                strokeWidth={hover?.region.path === region.node.path ? 1.5 : 1}
              />
              {region.w > 70 && region.h > 26 && (
                <text
                  x={region.x + 9}
                  y={region.y + 16}
                  fontSize={11}
                  fontWeight={600}
                  fontFamily="ui-monospace, Menlo, monospace"
                  fill="var(--ink)"
                >
                  {`${region.node.name}${isDir ? "/" : ""}`.slice(0, Math.floor(region.w / 7))}
                  <tspan fill="var(--ink-2)" fontWeight={400}>
                    {region.w > 150 ? `  ${formatPercent(percent)}` : ""}
                  </tspan>
                </text>
              )}
              {kids.map((cell) => {
                const cellPct =
                  cell.node.total === 0 ? null : (cell.node.covered / cell.node.total) * 100;
                return (
                  // biome-ignore lint/a11y/useKeyWithMouseEvents: hover detail is supplementary
                  <g
                    key={cell.node.path}
                    onMouseEnter={(e) => {
                      e.stopPropagation();
                      setHover({ node: cell.node, region: region.node });
                    }}
                    onMouseLeave={() => setHover({ node: region.node, region: region.node })}
                  >
                    <rect
                      x={cell.x + 1}
                      y={cell.y + 1}
                      width={Math.max(0, cell.w - 2)}
                      height={Math.max(0, cell.h - 2)}
                      rx={4}
                      fill={FILL[severity(cellPct)]}
                      opacity={hover?.node.path === cell.node.path ? 0.55 : 0.32}
                    />
                    {cell.w > 66 && cell.h > 20 && (
                      <text
                        x={cell.x + 6}
                        y={cell.y + 14}
                        fontSize={9.5}
                        fontFamily="ui-monospace, Menlo, monospace"
                        fill="var(--ink)"
                      >
                        {`${cell.node.name}${cell.node.file === null ? "/" : ""}`.slice(
                          0,
                          Math.floor(cell.w / 6.5),
                        )}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
      {hover && (
        <div className="pointer-events-none absolute top-3 left-1/2 z-10 -translate-x-1/2 rounded-lg border border-(--border) bg-(--surface) px-3 py-1.5 text-xs shadow-lg">
          <div>
            <span className="font-mono">
              {hover.node.path}
              {hover.node.file === null ? "/" : ""}
            </span>
            <span className="mx-2 text-(--muted)">·</span>
            <span className="font-semibold tabular-nums">
              {formatPercent(
                hover.node.total === 0 ? null : (hover.node.covered / hover.node.total) * 100,
              )}
            </span>
            <span className="ml-1.5 text-(--muted)">
              ({(hover.node.total - hover.node.covered).toLocaleString()} missed
              {hover.node.file === null ? ` · ${hover.node.fileCount.toLocaleString()} files` : ""})
            </span>
          </div>
          <div className="mt-0.5 text-(--muted)">
            Click to zoom into <span className="font-mono">{hover.region.name}/</span>
          </div>
        </div>
      )}
      <p className="mt-2 px-2 text-[11.5px] text-(--muted)">
        Area = coverable lines · color = coverage · click a directory to zoom in. Big warm blocks
        are where tests pay off most.
      </p>
    </div>
  );
}
