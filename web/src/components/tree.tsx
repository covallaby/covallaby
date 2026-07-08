import { ChevronRight, FileCode2, Folder } from "lucide-react";
import { useMemo, useState } from "react";
import { formatPercent, severity } from "../api.js";
import { Meter, inkFor } from "./ui.js";

export interface FileEntry {
  path: string;
  covered: number;
  total: number;
  percent: number | null;
  missing: string;
}

interface TreeNode {
  name: string;
  path: string;
  covered: number;
  total: number;
  children: TreeNode[];
  file: FileEntry | null;
}

function buildTree(files: FileEntry[]): TreeNode {
  const root: TreeNode = { name: "", path: "", covered: 0, total: 0, children: [], file: null };
  for (const file of files) {
    const parts = file.path.split("/");
    let node = root;
    let acc = "";
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      acc = acc ? `${acc}/${part}` : part;
      let child = node.children.find((c) => c.name === part);
      if (!child) {
        child = { name: part, path: acc, covered: 0, total: 0, children: [], file: null };
        node.children.push(child);
      }
      node = child;
      if (i === parts.length - 1) node.file = file;
    }
  }
  // Collapse single-child directory chains (src/main/java → one row).
  const collapse = (input: TreeNode): TreeNode => {
    let node = input;
    while (node.children.length === 1 && node.children[0]!.file === null && node.file === null) {
      const only = node.children[0]!;
      node = { ...only, name: node.name ? `${node.name}/${only.name}` : only.name };
    }
    node.children = node.children.map(collapse);
    return node;
  };
  // Aggregate counts + sort: directories first, worst coverage first.
  const finish = (node: TreeNode): TreeNode => {
    if (node.file) {
      node.covered = node.file.covered;
      node.total = node.file.total;
    } else {
      node.children = node.children.map(finish);
      node.covered = node.children.reduce((n, c) => n + c.covered, 0);
      node.total = node.children.reduce((n, c) => n + c.total, 0);
    }
    node.children.sort((a, b) => {
      if (!!a.file !== !!b.file) return a.file ? 1 : -1;
      const pa = a.total === 0 ? 101 : (a.covered / a.total) * 100;
      const pb = b.total === 0 ? 101 : (b.covered / b.total) * 100;
      return pa - pb;
    });
    return node;
  };
  return finish({ ...collapse(root), name: "" });
}

function pctOf(node: TreeNode): number | null {
  return node.total === 0 ? null : (node.covered / node.total) * 100;
}

function Row({
  node,
  depth,
  open,
  toggle,
}: {
  node: TreeNode;
  depth: number;
  open: Set<string>;
  toggle: (path: string) => void;
}) {
  const isDir = node.file === null;
  const expanded = open.has(node.path);
  const percent = pctOf(node);
  return (
    <>
      <button
        type="button"
        onClick={() => isDir && toggle(node.path)}
        className={`grid w-full grid-cols-[minmax(0,1fr)_88px_56px_110px] items-center gap-3 rounded-lg px-2 py-[7px] text-left transition-colors ${
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
            className={`truncate font-mono text-[12.5px] ${isDir ? "text-(--ink)" : "text-(--ink-2)"}`}
          >
            {node.name}
          </span>
          {!isDir && node.file!.missing && (
            <span className="hidden truncate font-mono text-[11px] text-(--muted) lg:inline">
              missing {node.file!.missing}
            </span>
          )}
        </span>
        <span className="text-right font-mono text-[11.5px] text-(--muted) tabular-nums">
          {node.covered.toLocaleString()}/{node.total.toLocaleString()}
        </span>
        <span
          className={`text-right text-[12px] font-semibold tabular-nums ${inkFor[severity(percent)]}`}
        >
          {formatPercent(percent)}
        </span>
        <Meter percent={percent} />
      </button>
      {isDir &&
        expanded &&
        node.children.map((c) => (
          <Row key={c.path} node={c} depth={depth + 1} open={open} toggle={toggle} />
        ))}
    </>
  );
}

export function FileTree({ files }: { files: FileEntry[] }) {
  const tree = useMemo(() => buildTree(files), [files]);
  const [open, setOpen] = useState<Set<string>>(
    () => new Set(tree.children.filter((c) => !c.file).map((c) => c.path)),
  );
  const toggle = (path: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  return (
    <div className="px-3 pb-3">
      {tree.children.map((c) => (
        <Row key={c.path} node={c} depth={0} open={open} toggle={toggle} />
      ))}
    </div>
  );
}
