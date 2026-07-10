import { type ReactNode, useState } from "react";
import { type Severity, formatPercent, severity } from "../api.js";

/** A GitHub org/user avatar (github.com/:owner.png), with a monogram fallback. */
export function OwnerAvatar({ owner, size = 20 }: { owner: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center rounded-full bg-(--surface-2) font-semibold text-(--muted)"
        style={{ width: size, height: size, fontSize: size * 0.48 }}
        aria-hidden="true"
      >
        {owner.charAt(0).toUpperCase()}
      </span>
    );
  }
  return (
    <img
      src={`https://github.com/${owner}.png?size=${size * 2}`}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      className="shrink-0 rounded-full"
      onError={() => setFailed(true)}
    />
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`flex flex-col rounded-xl border border-(--border) bg-(--surface) shadow-[0_1px_2px_rgba(0,0,0,.04)] ${className}`}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
      <div>
        <div className="text-[13.5px] font-semibold tracking-tight">{title}</div>
        {description && <div className="mt-0.5 text-xs text-(--muted)">{description}</div>}
      </div>
      {action}
    </div>
  );
}

export function CardFooter({ children }: { children: ReactNode }) {
  return (
    <div className="mt-auto border-t border-(--hairline) px-5 py-2.5 text-xs text-(--muted)">
      {children}
    </div>
  );
}

const fill: Record<Severity, string> = {
  good: "bg-(--good)",
  ok: "bg-(--ok)",
  warn: "bg-(--warn)",
  bad: "bg-(--bad)",
  muted: "bg-(--muted)",
};
const track: Record<Severity, string> = {
  good: "bg-(--good-track)",
  ok: "bg-(--ok-track)",
  warn: "bg-(--warn-track)",
  bad: "bg-(--bad-track)",
  muted: "bg-(--surface-2)",
};
export const inkFor: Record<Severity, string> = {
  good: "text-(--good)",
  ok: "text-(--ok)",
  warn: "text-(--warn)",
  bad: "text-(--bad)",
  muted: "text-(--muted)",
};

/** Severity meter: fill carries state, track is a lighter step of the same ramp. */
export function Meter({ percent, className = "" }: { percent: number | null; className?: string }) {
  const s = severity(percent);
  const width = percent === null ? 0 : Math.max(percent, 2);
  return (
    <div
      className={`h-1.5 overflow-hidden rounded-full ${track[s]} ${className}`}
      role="meter"
      aria-valuenow={percent ?? 0}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={`h-full rounded-full transition-[width] duration-500 ${fill[s]}`}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

export function Pct({ percent, className = "" }: { percent: number | null; className?: string }) {
  return (
    <span className={`font-semibold tabular-nums ${inkFor[severity(percent)]} ${className}`}>
      {formatPercent(percent)}
    </span>
  );
}

/** Delta vs the previous upload: a small direction chip. */
export function DeltaChip({
  current,
  previous,
}: {
  current: number | null;
  previous: number | null | undefined;
}) {
  if (current === null || previous === null || previous === undefined) return null;
  const diff = current - previous;
  if (Math.abs(diff) < 0.05) {
    return (
      <span className="rounded-full bg-(--surface-2) px-2.5 py-0.5 text-xs font-semibold tracking-normal whitespace-nowrap text-(--muted)">
        — steady
      </span>
    );
  }
  const up = diff > 0;
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold tracking-normal whitespace-nowrap ${
        up ? "bg-(--chip-up-bg) text-(--chip-up)" : "bg-(--chip-down-bg) text-(--chip-down)"
      }`}
    >
      {up ? "▲" : "▼"} {Math.abs(diff).toFixed(1)}%
    </span>
  );
}

export function Stat({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div>
      <div className="text-xl font-semibold tracking-tight">{value}</div>
      <div className="mt-0.5 text-xs text-(--muted)">{label}</div>
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="mt-8 mb-3 text-xs font-semibold tracking-wide text-(--muted) uppercase">
      {children}
    </h2>
  );
}

export function Th({
  children,
  right = false,
}: {
  children?: ReactNode;
  right?: boolean;
}) {
  return (
    <th
      className={`px-4 pb-2.5 text-xs font-medium tracking-wide text-(--muted) uppercase ${right ? "text-right" : "text-left"}`}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  className = "",
}: {
  children?: ReactNode;
  className?: string;
}) {
  return <td className={`border-t border-(--hairline) px-4 py-2.5 ${className}`}>{children}</td>;
}

/**
 * A branch/PR pill. The default branch (main/master) reads neutral; a PR or any
 * other branch reads amber — so "is this main?" is answerable at a glance.
 */
export function BranchTag({ branch, pr }: { branch: string; pr?: number | null }) {
  const isDefault = !pr && (branch === "main" || branch === "master");
  return (
    <span
      title={isDefault ? "Default branch" : "Not the default branch"}
      className={`inline-block max-w-full truncate rounded-full border px-2 py-0.5 align-middle font-mono text-[11px] ${
        isDefault
          ? "border-(--hairline) bg-(--surface-2) text-(--ink-2)"
          : "border-(--warn) text-(--warn)"
      }`}
    >
      {pr ? `PR #${pr}` : branch}
    </span>
  );
}
