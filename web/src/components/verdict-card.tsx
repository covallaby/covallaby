import { Link } from "react-router-dom";
import { type BaselineInfo, type PolicyVerdict, formatPercent } from "../api.js";
import { BaselineChip } from "./baseline-chip.js";
import { Card } from "./ui.js";

/**
 * The "can I merge?" answer, first. A binary Passed/Failed against the repo's
 * coverage policy, followed by the numbers that produced it — with the
 * baseline context right underneath so the two read as one story. Language
 * and layout align with the Ready/Incomplete/Blocked commit status card.
 */
export function VerdictCard({
  repo,
  verdict,
  baseline,
}: {
  repo: string;
  verdict?: PolicyVerdict;
  baseline?: BaselineInfo | null;
}) {
  // Older servers and snapshots don't send a verdict — keep the baseline
  // context on the page anyway.
  if (!verdict) return <BaselineChip baseline={baseline} />;

  if (!verdict.configured) {
    return (
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-4 sm:px-5">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-lg font-semibold text-(--muted)">No policy set</span>
              <span className="text-xs text-(--muted)">merge gate</span>
            </div>
            <p className="mt-1 text-xs text-(--muted)">
              Nothing gates this merge yet — totally fine. Set a merge policy and this becomes a
              clear Passed or Failed.
            </p>
            {baseline?.message ? (
              <div className="mt-2.5">
                <BaselineChip baseline={baseline} />
              </div>
            ) : null}
          </div>
          <Link
            to={`/r/${repo}/policy`}
            className="text-xs font-medium text-(--ink-2) hover:underline"
          >
            Set a policy →
          </Link>
        </div>
      </Card>
    );
  }

  const { rules, head, base, newFiles, violations, passed } = verdict;
  const failed = new Set(violations.map((v) => v.kind));
  const delta = head.percent !== null && base?.percent != null ? head.percent - base.percent : null;

  const stats: Array<{ key: string; label: string; value: string; detail: string; ok: boolean }> =
    [];
  if (rules?.minProject !== undefined) {
    stats.push({
      key: "project",
      label: "Project coverage",
      value: formatPercent(head.percent),
      detail: `floor ≥ ${formatPercent(rules.minProject)}`,
      ok: !failed.has("project"),
    });
  }
  if (rules?.maxDrop !== undefined) {
    stats.push({
      key: "drop",
      label: "Delta vs baseline",
      value: delta === null ? "—" : `${delta < 0 ? "−" : "+"}${Math.abs(delta).toFixed(1)}%`,
      detail: base
        ? `from ${formatPercent(base.percent)} · drop ≤ ${formatPercent(rules.maxDrop)} allowed`
        : "nothing to compare against yet",
      ok: !failed.has("drop"),
    });
  }
  if (rules?.minNewFile !== undefined) {
    stats.push({
      key: "new-file",
      label: "New files",
      value: !newFiles
        ? "—"
        : newFiles.total === 0
          ? "None added"
          : newFiles.belowFloor === 0
            ? `${newFiles.total} clear`
            : `${newFiles.belowFloor} of ${newFiles.total} below`,
      detail: `each floor ≥ ${formatPercent(rules.minNewFile)}`,
      ok: !failed.has("new-file"),
    });
  }

  const cols =
    stats.length >= 3 ? "sm:grid-cols-3" : stats.length === 2 ? "sm:grid-cols-2" : "sm:grid-cols-1";

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-(--hairline) px-4 py-4 sm:px-5">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-lg font-semibold ${passed ? "text-(--good)" : "text-(--bad)"}`}>
              {passed ? "Passed" : "Failed"}
            </span>
            <span className="text-xs text-(--muted)">merge gate</span>
            <span className="font-mono text-xs text-(--muted)">{head.commit.slice(0, 10)}</span>
          </div>
          <p className="mt-1 text-xs text-(--muted)">
            {passed
              ? "This coverage clears every rule in the repo's merge policy."
              : "This coverage is below the repo's merge policy — details below."}
          </p>
          {baseline?.message ? (
            <div className="mt-2.5">
              <BaselineChip baseline={baseline} />
            </div>
          ) : null}
        </div>
        <Link
          to={`/r/${repo}/policy`}
          className="text-xs font-medium text-(--ink-2) hover:underline"
        >
          Policy →
        </Link>
      </div>
      {stats.length > 0 && (
        <div className={`grid divide-y divide-(--hairline) ${cols} sm:divide-x sm:divide-y-0`}>
          {stats.map((stat) => (
            <div key={stat.key} className="min-w-0 p-4 sm:p-5">
              <span className="flex items-center gap-1.5 text-xs font-medium text-(--muted)">
                <span className={stat.ok ? "text-(--good)" : "text-(--bad)"} aria-hidden="true">
                  {stat.ok ? "✓" : "✕"}
                </span>
                {stat.label}
              </span>
              <span
                className={`mt-2 block truncate text-[15px] font-semibold ${stat.ok ? "" : "text-(--bad)"}`}
              >
                {stat.value}
              </span>
              <span className="mt-1 block truncate text-xs text-(--muted)">{stat.detail}</span>
            </div>
          ))}
        </div>
      )}
      {!passed && violations.length > 0 && (
        <ul className="space-y-1.5 border-t border-(--hairline) px-4 py-3 sm:px-5">
          {violations.map((v) => (
            <li key={v.kind} className="flex gap-2 text-[12.5px] text-(--ink-2)">
              <span className="text-(--bad)" aria-hidden="true">
                ✕
              </span>
              {v.message}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
