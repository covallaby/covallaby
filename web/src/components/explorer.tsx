import { ChevronRight, FileCode2, Flame, Folder } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { formatPercent, severity } from "../api.js";
import { Meter, inkFor } from "./ui.js";

export interface FileEntry {
  path: string;
  covered: number;
  total: number;
  percent: number | null;
  missing: string;
}

export interface TreeNode {
  name: string;
  path: string;
  covered: number;
  total: number;
  missed: number;
  fileCount: number;
  children: TreeNode[];
  file: FileEntry | null;
}

export function buildTree(files: FileEntry[]): TreeNode {
  const root: TreeNode = {
    name: "",
    path: "",
    covered: 0,
    total: 0,
    missed: 0,
    fileCount: 0,
    children: [],
    file: null,
  };
  for (const file of files) {
    const parts = file.path.split("/");
    let node = root;
    let acc = "";
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      acc = acc ? `${acc}/${part}` : part;
      let child = node.children.find((c) => c.name === part);
      if (!child) {
        child = {
          name: part,
          path: acc,
          covered: 0,
          total: 0,
          missed: 0,
          fileCount: 0,
          children: [],
          file: null,
        };
        node.children.push(child);
      }
      node = child;
      if (i === parts.length - 1) node.file = file;
    }
  }
  const collapse = (input: TreeNode): TreeNode => {
    let node = input;
    while (node.children.length === 1 && node.children[0]!.file === null && node.file === null) {
      const only = node.children[0]!;
      node = { ...only, name: node.name ? `${node.name}/${only.name}` : only.name };
    }
    node.children = node.children.map(collapse);
    return node;
  };
  const finish = (node: TreeNode): TreeNode => {
    if (node.file) {
      node.covered = node.file.covered;
      node.total = node.file.total;
      node.fileCount = 1;
    } else {
      node.children = node.children.map(finish);
      node.covered = node.children.reduce((n, c) => n + c.covered, 0);
      node.total = node.children.reduce((n, c) => n + c.total, 0);
      node.fileCount = node.children.reduce((n, c) => n + c.fileCount, 0);
    }
    node.missed = node.total - node.covered;
    // The analysis order: where the most uncovered code lives, first.
    node.children.sort((a, b) => b.missed - a.missed);
    return node;
  };
  return finish({ ...collapse(root), name: "" });
}

function pctOf(node: TreeNode): number | null {
  return node.total === 0 ? null : (node.covered / node.total) * 100;
}

/** Auto-expand along the heaviest-missed directories until ~budget rows show. */
function autoExpand(root: TreeNode, budget = 28): Set<string> {
  const open = new Set<string>();
  let visible = root.children.length;
  const queue = [...root.children].filter((c) => !c.file);
  while (queue.length > 0 && visible < budget) {
    queue.sort((a, b) => b.missed - a.missed);
    const next = queue.shift()!;
    if (next.missed === 0) break;
    open.add(next.path);
    visible += next.children.length;
    for (const c of next.children) if (!c.file) queue.push(c);
  }
  return open;
}

/** Ancestor paths of every file whose path matches the query. */
function expandForQuery(root: TreeNode, query: string): { open: Set<string>; keep: Set<string> } {
  const open = new Set<string>();
  const keep = new Set<string>();
  const walk = (node: TreeNode, ancestors: string[]): boolean => {
    const selfMatch = node.file !== null && node.path.toLowerCase().includes(query);
    let childMatch = false;
    for (const c of node.children) if (walk(c, [...ancestors, node.path])) childMatch = true;
    if (selfMatch || childMatch) {
      keep.add(node.path);
      for (const a of ancestors) {
        open.add(a);
        keep.add(a);
      }
      if (childMatch) open.add(node.path);
      return true;
    }
    return false;
  };
  for (const c of root.children) walk(c, []);
  return { open, keep };
}

const MAX_CHILDREN_SHOWN = 25;

function Row({
  node,
  depth,
  open,
  toggle,
  keep,
}: {
  node: TreeNode;
  depth: number;
  open: Set<string>;
  toggle: (path: string) => void;
  keep: Set<string> | null;
}) {
  const [showAll, setShowAll] = useState(false);
  if (keep && !keep.has(node.path)) return null;
  const isDir = node.file === null;
  const expanded = open.has(node.path);
  const percent = pctOf(node);
  const kids = keep ? node.children.filter((c) => keep.has(c.path)) : node.children;
  const shown = showAll ? kids : kids.slice(0, MAX_CHILDREN_SHOWN);
  return (
    <>
      <button
        type="button"
        onClick={() => isDir && toggle(node.path)}
        className={`grid w-full grid-cols-[minmax(0,1fr)_92px_88px_56px_110px] items-center gap-3 rounded-lg px-2 py-[6px] text-left transition-colors ${
          isDir ? "hover:bg-(--surface-2)" : "cursor-default"
        }`}
      >
        <span className="flex min-w-0 items-center gap-1.5" style={{ paddingLeft: depth * 18 }}>
          {isDir ? (
            <>
              <ChevronRight
                size={13}
                className={`shrink-0 text-(--muted) transition-transform ${expanded ? "rotate-90" : ""}`}
              />
              <Folder size={14} className="shrink-0 text-(--accent)" strokeWidth={1.75} />
            </>
          ) : (
            <>
              <span className="w-[13px] shrink-0" />
              <FileCode2 size={14} className="shrink-0 text-(--muted)" strokeWidth={1.75} />
            </>
          )}
          <span
            className={`min-w-0 truncate font-mono text-[12.5px] ${isDir ? "text-(--ink)" : "text-(--ink-2)"}`}
            title={!isDir && node.file!.missing ? `missing ${node.file!.missing}` : undefined}
          >
            {node.name}
          </span>
        </span>
        <span className="text-right text-[11.5px] tabular-nums">
          {node.missed > 0 ? (
            <span className="text-(--ink-2)">{node.missed.toLocaleString()} missed</span>
          ) : (
            <span className="text-(--muted)">—</span>
          )}
        </span>
        <span className="text-right font-mono text-[11.5px] text-(--muted) tabular-nums">
          {isDir ? `${node.fileCount.toLocaleString()} files` : `${node.covered}/${node.total}`}
        </span>
        <span
          className={`text-right text-[12px] font-semibold tabular-nums ${inkFor[severity(percent)]}`}
        >
          {formatPercent(percent)}
        </span>
        <Meter percent={percent} />
      </button>
      {isDir && expanded && (
        <>
          {shown.map((c) => (
            <Row key={c.path} node={c} depth={depth + 1} open={open} toggle={toggle} keep={keep} />
          ))}
          {kids.length > shown.length && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="px-2 py-1 text-left text-[12px] text-(--ink-2) hover:underline"
              style={{ paddingLeft: (depth + 1) * 18 + 8 }}
            >
              Show {kids.length - shown.length} more…
            </button>
          )}
        </>
      )}
    </>
  );
}

export function Hotspots({
  files,
  onPick,
}: {
  files: FileEntry[];
  onPick: (path: string) => void;
}) {
  const top = useMemo(
    () =>
      [...files]
        .map((f) => ({ ...f, missed: f.total - f.covered }))
        .filter((f) => f.missed > 0)
        .sort((a, b) => b.missed - a.missed)
        .slice(0, 7),
    [files],
  );
  if (top.length === 0) return null;
  const totalMissed = files.reduce((n, f) => n + (f.total - f.covered), 0);
  const topShare = Math.round((top.reduce((n, f) => n + f.missed, 0) / totalMissed) * 100);
  const max = top[0]!.missed;
  return (
    <div>
      <div className="flex items-center gap-1.5 px-5 pb-1 text-[11.5px] text-(--muted)">
        <Flame size={12} className="text-(--warn)" />
        These {top.length} files hold {topShare}% of all missed lines
      </div>
      <div className="space-y-0.5 px-3 pb-3">
        {top.map((f) => (
          <button
            key={f.path}
            type="button"
            onClick={() => onPick(f.path)}
            title={f.path}
            className="grid w-full grid-cols-[minmax(0,1fr)_84px] items-center gap-3 rounded-lg px-2 py-[7px] text-left transition-colors hover:bg-(--surface-2)"
          >
            <span className="min-w-0">
              <span className="block truncate font-mono text-[12px] text-(--ink-2)">
                {f.path.split("/").slice(-2).join("/")}
              </span>
              <span className="mt-1 block h-1 overflow-hidden rounded-full bg-(--surface-2)">
                <span
                  className="block h-full rounded-full bg-(--bad) opacity-70"
                  style={{ width: `${Math.max(4, (f.missed / max) * 100)}%` }}
                />
              </span>
            </span>
            <span className="text-right text-[11.5px] font-semibold text-(--ink-2) tabular-nums">
              {f.missed.toLocaleString()} missed
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function TreeOutline({ files, query }: { files: FileEntry[]; query: string }) {
  const tree = useMemo(() => buildTree(files), [files]);
  const q = query.trim().toLowerCase();
  const searched = useMemo(() => (q ? expandForQuery(tree, q) : null), [tree, q]);
  const [open, setOpen] = useState<Set<string>>(() => autoExpand(tree));
  useEffect(() => {
    setOpen(q && searched ? searched.open : autoExpand(tree));
  }, [q, searched, tree]);
  const toggle = (path: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  const keep = searched?.keep ?? null;
  const roots = keep ? tree.children.filter((c) => keep.has(c.path)) : tree.children;
  return (
    <div className="px-3 pb-3">
      {roots.map((c) => (
        <Row key={c.path} node={c} depth={0} open={open} toggle={toggle} keep={keep} />
      ))}
      {roots.length === 0 && (
        <p className="px-2 py-3 text-[13px] text-(--muted)">Nothing matches "{query}".</p>
      )}
    </div>
  );
}

export function Breadcrumb({
  path,
  onNavigate,
}: {
  path: string;
  onNavigate: (path: string) => void;
}) {
  const parts = path === "" ? [] : path.split("/");
  return (
    <div className="flex flex-wrap items-center gap-1 px-5 pb-2 font-mono text-[12.5px]">
      <button
        type="button"
        onClick={() => onNavigate("")}
        className={parts.length === 0 ? "text-(--ink)" : "text-(--muted) hover:text-(--ink)"}
      >
        root
      </button>
      {parts.map((part, i) => {
        const target = parts.slice(0, i + 1).join("/");
        const last = i === parts.length - 1;
        return (
          <span key={target} className="flex items-center gap-1">
            <span className="text-(--muted)">/</span>
            <button
              type="button"
              onClick={() => onNavigate(target)}
              className={last ? "text-(--ink)" : "text-(--muted) hover:text-(--ink)"}
            >
              {part}
            </button>
          </span>
        );
      })}
    </div>
  );
}
