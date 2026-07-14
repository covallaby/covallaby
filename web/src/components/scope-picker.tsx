import { Check, ChevronsUpDown, GitBranch, GitPullRequest, Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { PROverview } from "../api.js";

/**
 * ScopePicker — a searchable combobox over a repo's scopes (branches and,
 * optionally, open pull requests), SonarCloud-style. The pure helpers below
 * (items, filtering, keyboard moves) are exported for tests.
 */

export interface ScopeItem {
  kind: "branch" | "pr";
  /** Branch name, or the PR number as a string. */
  value: string;
  label: string;
  /** Secondary text (a PR's branch). */
  detail?: string;
  /** The default branch, pinned to the top of its section. */
  pinned?: boolean;
}

/** The repo's default branch: main, then master, then the first branch. */
export function defaultBranchOf(branches: string[]): string | undefined {
  return branches.find((b) => b === "main") ?? branches.find((b) => b === "master") ?? branches[0];
}

/** Branch items with the default branch pinned at the top. */
export function branchItems(branches: string[]): ScopeItem[] {
  const def = defaultBranchOf(branches);
  const items: ScopeItem[] = [];
  if (def !== undefined) items.push({ kind: "branch", value: def, label: def, pinned: true });
  for (const b of branches) {
    if (b !== def) items.push({ kind: "branch", value: b, label: b });
  }
  return items;
}

/** Open-PR items: "PR #128" with the PR's branch as detail. */
export function prItems(prs: PROverview[]): ScopeItem[] {
  return prs.map((p) => ({
    kind: "pr",
    value: String(p.pr),
    label: `PR #${p.pr}`,
    detail: p.latest.branch,
  }));
}

/** Case-insensitive substring filter over label + detail (so "128" and a PR's branch both hit). */
export function filterScopeItems(items: ScopeItem[], query: string): ScopeItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter(
    (i) => i.label.toLowerCase().includes(q) || (i.detail?.toLowerCase().includes(q) ?? false),
  );
}

/** Next active index for ↑/↓, wrapping at both ends. -1 when the list is empty. */
export function moveActive(count: number, current: number, delta: 1 | -1): number {
  if (count === 0) return -1;
  if (current < 0) return delta === 1 ? 0 : count - 1;
  return (current + delta + count) % count;
}

export type PickerKeyAction =
  | { type: "move"; index: number }
  | { type: "select" }
  | { type: "close" }
  | null;

/** Maps a key press in the search input to a picker action (null = let the input handle it). */
export function keyActionFor(key: string, count: number, active: number): PickerKeyAction {
  switch (key) {
    case "ArrowDown":
      return { type: "move", index: moveActive(count, active, 1) };
    case "ArrowUp":
      return { type: "move", index: moveActive(count, active, -1) };
    case "Enter":
      return count > 0 && active >= 0 && active < count ? { type: "select" } : null;
    case "Escape":
      return { type: "close" };
    default:
      return null;
  }
}

function keyOf(item: ScopeItem): string {
  return `${item.kind}:${item.value}`;
}

export function ScopePicker({
  label,
  current,
  branches,
  onSelectBranch,
  loadPullRequests,
  onSelectPullRequest,
  className = "",
}: {
  /** Accessible name, e.g. "Branch" or "Head branch". */
  label: string;
  /** The currently selected scope, shown on the trigger button. */
  current: string;
  branches: string[];
  onSelectBranch: (branch: string) => void;
  /** When provided, an "Open pull requests" section is fetched lazily on first open. */
  loadPullRequests?: () => Promise<PROverview[]>;
  onSelectPullRequest?: (pr: number) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  /** null = not fetched yet (or still in flight). */
  const [prs, setPrs] = useState<PROverview[] | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const wantPrs = loadPullRequests !== undefined;

  // Fetch open PRs lazily, the first time the panel opens.
  useEffect(() => {
    if (!open || !loadPullRequests || prs !== null) return;
    let live = true;
    loadPullRequests()
      .then((list) => live && setPrs(list))
      .catch(() => live && setPrs([]));
    return () => {
      live = false;
    };
  }, [open, loadPullRequests, prs]);

  // Focus the search input when the panel opens.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Click outside closes.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const filteredBranches = useMemo(
    () => filterScopeItems(branchItems(branches), query),
    [branches, query],
  );
  const filteredPrs = useMemo(() => filterScopeItems(prItems(prs ?? []), query), [prs, query]);
  const flat = useMemo(
    () => [...filteredBranches, ...filteredPrs],
    [filteredBranches, filteredPrs],
  );

  const close = (refocus = true) => {
    setOpen(false);
    setQuery("");
    setActive(0);
    if (refocus) buttonRef.current?.focus();
  };

  const select = (item: ScopeItem) => {
    if (item.kind === "branch") onSelectBranch(item.value);
    else onSelectPullRequest?.(Number(item.value));
    close();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Tab") {
      // The input is the only tab stop in the panel — trap focus while open.
      e.preventDefault();
      return;
    }
    const action = keyActionFor(e.key, flat.length, active);
    if (!action) return;
    e.preventDefault();
    if (action.type === "move") setActive(action.index);
    else if (action.type === "select") select(flat[active]!);
    else close();
  };

  const activeItem = flat[active];

  const renderOption = (item: ScopeItem, index: number) => {
    const isActive = index === active;
    const isCurrent = item.kind === "branch" && item.value === current;
    return (
      // useSemanticElements is off for this file (biome.json): a <select> can't offer
      // type-ahead + grouped PR rows, so this is the ARIA listbox/option pattern instead.
      // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard runs through the search input (aria-activedescendant); click is the mouse path
      <div
        key={keyOf(item)}
        id={`${listId}-opt-${index}`}
        role="option"
        aria-selected={isCurrent}
        tabIndex={-1}
        onPointerDown={(e) => e.preventDefault()}
        onClick={() => select(item)}
        onMouseMove={() => setActive(index)}
        className={`flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 ${
          isActive ? "bg-(--surface-2)" : ""
        }`}
      >
        {item.kind === "pr" ? (
          <GitPullRequest size={13} className="shrink-0 text-(--muted)" />
        ) : (
          <GitBranch size={13} className="shrink-0 text-(--muted)" />
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-(--ink)">
          {item.label}
          {item.detail && (
            <span className="ml-1.5 font-sans text-[11px] text-(--muted)">{item.detail}</span>
          )}
        </span>
        {item.pinned && (
          <span className="shrink-0 rounded-full border border-(--hairline) bg-(--surface-2) px-1.5 py-px text-[10px] text-(--muted)">
            default
          </span>
        )}
        {isCurrent && <Check size={13} className="shrink-0 text-(--accent)" />}
      </div>
    );
  };

  return (
    <div ref={rootRef} className={`relative min-w-0 ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => (open ? close() : setOpen(true))}
        className="flex w-full min-w-0 items-center gap-2 rounded-lg border border-(--border) bg-(--surface) px-2.5 py-2 text-left transition-colors hover:border-(--muted)"
      >
        <GitBranch size={14} className="shrink-0 text-(--muted)" />
        <span className="min-w-0 flex-1 truncate font-mono text-xs font-medium text-(--ink)">
          {current}
        </span>
        <ChevronsUpDown size={13} className="shrink-0 text-(--muted)" />
      </button>
      {open && (
        <div className="absolute left-0 z-30 mt-1.5 w-full min-w-64 rounded-xl border border-(--border) bg-(--surface) shadow-[0_8px_24px_rgba(0,0,0,.12)] sm:w-80">
          <div className="flex items-center gap-2 border-b border-(--hairline) px-3">
            <Search size={13} className="shrink-0 text-(--muted)" />
            <input
              ref={inputRef}
              role="combobox"
              aria-expanded={open}
              aria-controls={listId}
              aria-activedescendant={activeItem ? `${listId}-opt-${active}` : undefined}
              aria-label={`Search ${label.toLowerCase()}`}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              placeholder={wantPrs ? "Filter branches & PRs…" : "Filter branches…"}
              className="w-full min-w-0 bg-transparent py-2 text-[13px] text-(--ink) outline-none placeholder:text-(--muted)"
            />
          </div>
          <div
            id={listId}
            role="listbox"
            aria-label={label}
            tabIndex={-1}
            className="max-h-72 overflow-y-auto p-1.5"
          >
            <div className="px-2.5 pt-1.5 pb-1 text-[10.5px] font-semibold tracking-wide text-(--muted) uppercase">
              Branches
            </div>
            {filteredBranches.length === 0 && (
              <p className="px-2.5 pb-1.5 text-xs text-(--muted)">No matching branches.</p>
            )}
            {filteredBranches.map((item, i) => renderOption(item, i))}
            {wantPrs && (
              <>
                <div className="mt-1 border-t border-(--hairline) px-2.5 pt-2 pb-1 text-[10.5px] font-semibold tracking-wide text-(--muted) uppercase">
                  Open pull requests
                </div>
                {prs === null ? (
                  <p className="px-2.5 pb-1.5 text-xs text-(--muted)">Loading…</p>
                ) : filteredPrs.length === 0 ? (
                  <p className="px-2.5 pb-1.5 text-xs text-(--muted)">
                    {prs.length === 0 ? "No pull requests yet." : "No matching pull requests."}
                  </p>
                ) : (
                  filteredPrs.map((item, i) => renderOption(item, filteredBranches.length + i))
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
