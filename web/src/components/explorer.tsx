import { ChevronRight, FileCode2, Folder } from "lucide-react";
import { useMemo } from "react";
import { formatPercent, severity } from "../api.js";
import { Meter, inkFor } from "./ui.js";

export interface FileEntry {
  path: string;
  covered: number;
  total: number;
  percent: number | null;
  missing: string;
}

export interface Child {
  name: string;
  path: string;
  isDir: boolean;
  covered: number;
  total: number;
  fileCount: number;
  percent: number | null;
  missing: string;
}

/** Immediate children of `path`, directories aggregated, worst-first. */
export function childrenOf(files: FileEntry[], path: string): Child[] {
  const prefix = path === "" ? "" : `${path}/`;
  const map = new Map<string, Child>();
  for (const f of files) {
    if (!f.path.startsWith(prefix)) continue;
    const rest = f.path.slice(prefix.length);
    const slash = rest.indexOf("/");
    const isDir = slash !== -1;
    const name = isDir ? rest.slice(0, slash) : rest;
    const childPath = prefix + name;
    const entry = map.get(name) ?? {
      name,
      path: childPath,
      isDir,
      covered: 0,
      total: 0,
      fileCount: 0,
      percent: null,
      missing: "",
    };
    entry.covered += f.covered;
    entry.total += f.total;
    entry.fileCount += 1;
    if (!isDir) entry.missing = f.missing;
    map.set(name, entry);
  }
  const children = [...map.values()].map((c) => ({
    ...c,
    percent: c.total === 0 ? null : (c.covered / c.total) * 100,
  }));
  children.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return (a.percent ?? 101) - (b.percent ?? 101);
  });
  return children;
}

/** Collapse single-child directory chains for display: src/main/java as one hop. */
export function collapseChain(files: FileEntry[], path: string): string {
  let current = path;
  for (;;) {
    const kids = childrenOf(files, current);
    if (kids.length === 1 && kids[0]!.isDir) current = kids[0]!.path;
    else return current;
  }
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

export function Explorer({
  files,
  path,
  onNavigate,
}: {
  files: FileEntry[];
  path: string;
  onNavigate: (path: string) => void;
}) {
  const children = useMemo(() => childrenOf(files, path), [files, path]);
  const shown = children.slice(0, 150);
  return (
    <div className="px-3 pb-3">
      {shown.map((c) => (
        <button
          key={c.path}
          type="button"
          onClick={() => c.isDir && onNavigate(collapseChain(files, c.path))}
          className={`grid w-full grid-cols-[minmax(0,1fr)_72px_88px_56px_110px] items-center gap-3 rounded-lg px-2 py-[7px] text-left transition-colors ${
            c.isDir ? "hover:bg-(--surface-2)" : "cursor-default"
          }`}
        >
          <span className="flex min-w-0 items-center gap-2">
            {c.isDir ? (
              <Folder size={14} className="shrink-0 text-(--accent)" strokeWidth={1.75} />
            ) : (
              <FileCode2 size={14} className="shrink-0 text-(--muted)" strokeWidth={1.75} />
            )}
            <span
              className={`truncate font-mono text-[12.5px] ${c.isDir ? "text-(--ink)" : "text-(--ink-2)"}`}
            >
              {c.name}
              {c.isDir && "/"}
            </span>
            {!c.isDir && c.missing && (
              <span className="hidden truncate font-mono text-[11px] text-(--muted) xl:inline">
                missing {c.missing}
              </span>
            )}
            {c.isDir && <ChevronRight size={12} className="shrink-0 text-(--muted)" />}
          </span>
          <span className="text-right text-[11.5px] text-(--muted) tabular-nums">
            {c.isDir ? `${c.fileCount.toLocaleString()} files` : ""}
          </span>
          <span className="text-right font-mono text-[11.5px] text-(--muted) tabular-nums">
            {c.covered.toLocaleString()}/{c.total.toLocaleString()}
          </span>
          <span
            className={`text-right text-[12px] font-semibold tabular-nums ${inkFor[severity(c.percent)]}`}
          >
            {formatPercent(c.percent)}
          </span>
          <Meter percent={c.percent} />
        </button>
      ))}
      {children.length > shown.length && (
        <p className="px-2 pt-2 text-[12px] text-(--muted)">
          …and {children.length - shown.length} more entries — drill into a directory or use the
          Files tab to search.
        </p>
      )}
    </div>
  );
}
