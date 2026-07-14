import { formatPercent, severity } from "../api.js";
import { DeltaChip, Meter, inkFor } from "./ui.js";

/** The added/changed/removed shape UploadChanges and ReportChanges share. */
export interface ChangesListData {
  added: Array<{ path: string; percent: number | null; total: number }>;
  changed: Array<{ path: string; before: number | null; after: number | null }>;
  removed: number;
}

/**
 * The per-file "New files / Coverage moved / removed" list shared by the
 * Upload page (vs the previous upload on the branch) and the Compare/PR view
 * (vs the base branch). The two contexts word "removed" and "no differences"
 * differently, so those lines come from the caller.
 */
export function ChangesList({
  changes,
  removedNote,
  emptyNote,
}: {
  changes: ChangesListData;
  /** Copy for the removed-files line, given the count (only called when > 0). */
  removedNote: (count: number) => string;
  /** Copy for the nothing-changed case. */
  emptyNote: string;
}) {
  return (
    <div className="space-y-5 px-5 pb-4">
      {changes.added.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-(--muted) uppercase">
            New files ({changes.added.length})
          </h3>
          <div className="space-y-0.5">
            {changes.added.slice(0, 30).map((f) => (
              <div
                key={f.path}
                className="grid grid-cols-[minmax(0,1fr)_72px_56px_110px] items-center gap-3 rounded-lg px-2 py-1.5"
              >
                <span className="truncate font-mono text-[12.5px] text-(--ink-2)">{f.path}</span>
                <span className="text-right font-mono text-[11.5px] text-(--muted) tabular-nums">
                  {f.total} lines
                </span>
                <span
                  className={`text-right text-[12px] font-semibold tabular-nums ${inkFor[severity(f.percent)]}`}
                >
                  {formatPercent(f.percent)}
                </span>
                <Meter percent={f.percent} />
              </div>
            ))}
          </div>
        </div>
      )}
      {changes.changed.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-(--muted) uppercase">
            Coverage moved ({changes.changed.length})
          </h3>
          <div className="space-y-0.5">
            {changes.changed.slice(0, 30).map((f) => (
              <div
                key={f.path}
                className="grid grid-cols-[minmax(0,1fr)_150px_80px] items-center gap-3 rounded-lg px-2 py-1.5"
              >
                <span className="truncate font-mono text-[12.5px] text-(--ink-2)">{f.path}</span>
                <span className="text-right font-mono text-[12px] text-(--muted) tabular-nums">
                  {formatPercent(f.before)} →{" "}
                  <span className={inkFor[severity(f.after)]}>{formatPercent(f.after)}</span>
                </span>
                <span className="text-right">
                  <DeltaChip current={f.after} previous={f.before} />
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {changes.removed > 0 && (
        <p className="text-[12.5px] text-(--muted)">{removedNote(changes.removed)}</p>
      )}
      {changes.added.length === 0 && changes.changed.length === 0 && changes.removed === 0 && (
        <p className="text-sm text-(--muted)">{emptyNote}</p>
      )}
    </div>
  );
}
