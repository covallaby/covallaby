import { ChevronLeft, ChevronRight, GitMerge } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

/**
 * Lateral prev/next/base navigation (the Coveralls pattern): from any evidence
 * page, jump sideways through history without climbing back out to a list.
 * Ends of history render as disabled pills instead of disappearing, so the
 * control stays put while you walk the timeline.
 */

const pillClass =
  "inline-flex items-center gap-1 rounded-full border border-(--border) bg-(--surface-2) px-2.5 py-1 text-[11.5px] font-medium";

function NavPill({
  to,
  title,
  children,
}: {
  /** Destination, or null when this end of history is exhausted (disabled). */
  to: string | null;
  title?: string;
  children: ReactNode;
}) {
  if (!to) {
    return (
      <span
        aria-disabled="true"
        className={`${pillClass} cursor-not-allowed text-(--muted) opacity-45`}
      >
        {children}
      </span>
    );
  }
  return (
    <Link
      to={to}
      title={title}
      className={`${pillClass} text-(--ink-2) transition-colors hover:border-(--muted) hover:text-(--ink)`}
    >
      {children}
    </Link>
  );
}

export function LateralNav({
  prev,
  next,
  base,
  noun,
  className = "",
}: {
  /** Prev/next destination, or null at that end of history (renders disabled). */
  prev: { to: string; title?: string } | null;
  next: { to: string; title?: string } | null;
  /** Optional "Base build" link (PR uploads); omitted entirely when absent. */
  base?: { to: string; title?: string } | null;
  /** What one step is — "commit" on uploads, "run" on playbacks and previews. */
  noun: string;
  className?: string;
}) {
  return (
    <nav
      aria-label={`Previous and next ${noun}`}
      className={`flex flex-wrap items-center gap-1.5 ${className}`}
    >
      <NavPill to={prev?.to ?? null} title={prev?.title}>
        <ChevronLeft size={12} /> Previous {noun}
      </NavPill>
      {base ? (
        <NavPill to={base.to} title={base.title}>
          <GitMerge size={12} /> Base build
        </NavPill>
      ) : null}
      <NavPill to={next?.to ?? null} title={next?.title}>
        Next {noun} <ChevronRight size={12} />
      </NavPill>
    </nav>
  );
}
