import { Link, useLocation } from "react-router-dom";

/** One entry in the repo tab bar. Kept as plain config so reshaping tabs (COV-24) is a data edit. */
export interface RepoTab {
  label: string;
  /** Path segment under `/r/:owner/:name` — "" is the Overview index route. */
  to: string;
  /** Extra leading segments that highlight this tab (leaf/detail routes). */
  match?: string[];
}

export const REPO_TABS: RepoTab[] = [
  { label: "Overview", to: "" },
  { label: "Commits", to: "commits" },
  { label: "Uploads", to: "uploads", match: ["u"] },
  { label: "Journeys", to: "playbacks", match: ["test-runs"] },
  { label: "Captures", to: "storybook-previews" },
  { label: "Pull requests", to: "pulls", match: ["pr", "compare"] },
  { label: "Insights", to: "insights" },
  { label: "Policy", to: "policy" },
];

/** The first path segment after the repo base — "" on the repo root. */
function sectionSegment(pathname: string, base: string): string {
  if (pathname === base) return "";
  if (!pathname.startsWith(`${base}/`)) return "";
  return pathname.slice(base.length + 1).split("/")[0] ?? "";
}

/** GitHub-style horizontal section switcher, shown under the repo header on every repo route. */
export function RepoTabs({ repo }: { repo: string }) {
  const { pathname, search } = useLocation();
  const base = `/r/${repo}`;
  const segment = sectionSegment(pathname, base);
  return (
    <nav aria-label="Repository sections" className="border-b border-(--hairline)">
      <div
        className="-mb-px flex max-w-full gap-1 overflow-x-auto overscroll-x-contain"
        data-mobile-scroll-region
      >
        {REPO_TABS.map((tab) => {
          const active = segment === tab.to || (tab.match?.includes(segment) ?? false);
          return (
            <Link
              key={tab.label}
              to={{ pathname: tab.to ? `${base}/${tab.to}` : base, search }}
              aria-current={active ? "page" : undefined}
              className={`shrink-0 whitespace-nowrap border-b-2 px-2.5 pt-1 pb-2 text-[13px] transition-colors ${
                active
                  ? "border-(--accent) font-medium text-(--ink)"
                  : "border-transparent text-(--muted) hover:border-(--border) hover:text-(--ink)"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
