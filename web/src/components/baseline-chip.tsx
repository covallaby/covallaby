import { GitCommit } from "lucide-react";
import type { BaselineInfo } from "../api.js";

/**
 * A small, friendly pill explaining which baseline a comparison used and why:
 * "Baseline: abc1234 (latest on main)" or "No baseline — first build on this
 * branch". Renders nothing when the server didn't send baseline info (older
 * servers, demo fixtures).
 */
export function BaselineChip({ baseline }: { baseline?: BaselineInfo | null }) {
  if (!baseline?.message) return null;
  return (
    <span
      title={`Chosen by the baseline resolver (${baseline.reason})`}
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-(--border) bg-(--surface-2) px-2.5 py-1 text-[11px] text-(--muted)"
    >
      <GitCommit size={12} className="shrink-0 text-(--accent)" />
      <span className="truncate">{baseline.message}</span>
    </span>
  );
}
