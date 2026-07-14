import { ChevronDown, Github, Inbox, LayoutDashboard, Menu, Moon, Sun, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Link,
  Navigate,
  type RouteObject,
  useLocation,
  useNavigate,
  useParams,
  useRoutes,
  useSearchParams,
} from "react-router-dom";
import {
  type GitHubAppStatus,
  IS_DEMO,
  type Me,
  type RepoOverview,
  api,
  groupReposByOwner,
  shortRepoName,
} from "./api.js";
import { OwnerAvatar } from "./components/ui.js";
import { Commits } from "./pages/Commits.js";
import { CompareBranches, PullRequest } from "./pages/Compare.js";
import { Home } from "./pages/Home.js";
import { PlaybackDetail } from "./pages/Playbacks.js";
import { Policy } from "./pages/Policy.js";
import { RepoLayout } from "./pages/Repo.js";
import { Activity } from "./pages/RepoActivity.js";
import { Insights } from "./pages/RepoInsights.js";
import { PullRequests } from "./pages/RepoPulls.js";
import { Summary } from "./pages/RepoSummary.js";
import { StorybookPreviewDetail } from "./pages/StorybookPreviews.js";
import { Upload } from "./pages/Upload.js";
import { readRecentVisits, recordRepoVisit, selectRecentRepos } from "./recent-repos.js";

import logoUrl from "./assets/logo.png";

export function Mark({ size = 24 }: { size?: number }) {
  return <img src={logoUrl} width={size} height={size} alt="" aria-hidden="true" />;
}

type Theme = "light" | "dark";

function initTheme(): Theme {
  const fromUrl = new URLSearchParams(window.location.search).get("theme");
  if (fromUrl === "light" || fromUrl === "dark") return fromUrl;
  const saved = localStorage.getItem("covallaby-theme");
  if (saved === "light" || saved === "dark") return saved;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(initTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("covallaby-theme", next);
  };
  return [theme, toggle];
}

function SidebarLink({
  to,
  active,
  children,
}: {
  to: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      className={`flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors ${
        active
          ? "bg-(--accent-wash) font-medium text-(--ink)"
          : "text-(--ink-2) hover:bg-(--surface-2) hover:text-(--ink)"
      }`}
    >
      {children}
    </Link>
  );
}

async function signOut() {
  try {
    await fetch("/auth/logout", { method: "POST" });
  } catch {
    // ignore — we redirect regardless
  }
  window.location.href = "/";
}

function Sidebar({
  repos,
  me,
  githubApp,
  mobileOpen,
  onClose,
}: {
  repos: RepoOverview[] | null;
  me: Me | null;
  githubApp: GitHubAppStatus | null;
  mobileOpen: boolean;
  onClose: () => void;
}) {
  const { pathname, search } = useLocation();
  const reviewFocused = new URLSearchParams(search).get("focus") === "review";
  const currentRepo = repoFromPathname(pathname);
  const recent = selectRecentRepos({
    visits: readRecentVisits(),
    currentRepo,
    available: (repos ?? []).map((r) => r.repo),
  });
  return (
    <aside
      aria-label="Dashboard navigation"
      className={`fixed inset-y-0 left-0 z-40 flex w-[min(20rem,86vw)] flex-col border-r border-(--hairline) bg-(--surface) shadow-2xl transition-transform duration-200 md:z-20 md:w-60 md:translate-x-0 md:shadow-none ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}
    >
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
        <Mark />
        <div>
          <div className="text-[14px] leading-tight font-semibold tracking-tight">Covallaby</div>
          <div className="text-[11px] text-(--muted)">you’re covered 🌿</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close navigation"
          className="ml-auto rounded-lg border border-(--border) p-1.5 text-(--muted) md:hidden"
        >
          <X size={16} />
        </button>
      </div>
      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-3">
        <div className="space-y-0.5">
          <SidebarLink to="/" active={pathname === "/" && !reviewFocused}>
            <LayoutDashboard size={15} strokeWidth={1.75} /> Overview
          </SidebarLink>
          <SidebarLink to="/?focus=review" active={pathname === "/" && reviewFocused}>
            <Inbox size={15} strokeWidth={1.75} /> Needs attention
          </SidebarLink>
        </div>
        <div>
          <div className="px-2.5 pb-1.5 text-[10.5px] font-semibold tracking-widest text-(--muted) uppercase">
            Recent
          </div>
          <div className="space-y-0.5">
            {repos === null && recent.length === 0 && (
              <div className="space-y-2.5 px-2.5 py-1">
                <div className="h-7 animate-pulse rounded bg-(--surface-2)" />
                <div className="h-7 animate-pulse rounded bg-(--surface-2)" />
              </div>
            )}
            {recent.map((repo) => (
              <SidebarLink key={repo} to={`/r/${repo}`} active={currentRepo === repo}>
                <OwnerAvatar owner={repo.split("/")[0] ?? repo} size={16} />
                <span className="min-w-0 truncate font-mono text-[12px]" title={repo}>
                  {shortRepoName(repo)}
                </span>
              </SidebarLink>
            ))}
            {repos?.length === 0 && recent.length === 0 && (
              <p className="px-2.5 py-1 text-[12px] text-(--muted)">Nothing uploaded yet.</p>
            )}
            <Link
              to="/"
              className="block rounded-lg px-2.5 py-1.5 text-[12px] text-(--muted) transition-colors hover:bg-(--surface-2) hover:text-(--ink)"
            >
              All repositories →
            </Link>
          </div>
        </div>
      </nav>
      <div className="space-y-1 border-t border-(--hairline) px-3 py-3">
        {me?.authenticated && me.login && (
          <div className="flex items-center justify-between gap-2 px-2.5 py-1 text-[12.5px]">
            <span className="min-w-0 truncate text-(--ink-2)">
              <span className="text-(--muted)">@</span>
              {me.login}
            </span>
            <button
              type="button"
              onClick={signOut}
              className="shrink-0 text-[12px] text-(--muted) transition-colors hover:text-(--ink)"
            >
              Sign out
            </button>
          </div>
        )}
        {githubApp?.configured && (
          <a
            href="/api/v1/github/install"
            className="flex items-center gap-2.5 rounded-lg bg-(--accent-wash) px-2.5 py-2 text-[13px] font-medium text-(--ink) transition-colors hover:bg-(--surface-2)"
          >
            <Github size={15} strokeWidth={1.75} />
            {githubApp.accounts.some((account) => account.installed)
              ? "Manage repositories"
              : "Connect repositories"}
          </a>
        )}
        <a
          href="https://github.com/covallaby/action"
          className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] text-(--ink-2) transition-colors hover:bg-(--surface-2) hover:text-(--ink)"
        >
          <Github size={15} strokeWidth={1.75} /> covallaby/action
        </a>
      </div>
    </aside>
  );
}

/** The signed-out landing for the hosted tier: sign in with GitHub. */
function SignIn({ theme, toggleTheme }: { theme: Theme; toggleTheme: () => void }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-(--page) px-6">
      <button
        type="button"
        onClick={toggleTheme}
        aria-label="Toggle theme"
        className="absolute top-4 right-4 rounded-lg border border-(--border) bg-(--surface) p-1.5 text-(--ink-2) transition-colors hover:text-(--ink)"
      >
        {theme === "dark" ? (
          <Sun size={15} strokeWidth={1.75} />
        ) : (
          <Moon size={15} strokeWidth={1.75} />
        )}
      </button>
      <div className="w-full max-w-sm rounded-2xl border border-(--border) bg-(--surface) p-8 text-center shadow-[0_1px_2px_rgba(0,0,0,.05),0_24px_60px_-34px_rgba(0,0,0,.45)]">
        <img src={logoUrl} width={56} height={56} alt="" className="mx-auto mb-4" />
        <h1 className="text-xl font-semibold tracking-tight">Covallaby</h1>
        <p className="mt-2 text-sm text-(--ink-2)">
          Coverage history, dashboards, and merge gates for your repositories.
        </p>
        <a
          href="/auth/github/login"
          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-(--ink) px-4 py-2.5 text-sm font-medium text-(--surface) transition-opacity hover:opacity-90"
        >
          <Github size={16} strokeWidth={2} /> Sign in with GitHub
        </a>
        <p className="mt-4 text-[11px] text-(--muted)">You're covered. 🦘</p>
      </div>
    </div>
  );
}

/** Label for the trailing path segment of a repo route (Activity, PR #12, …). */
function tailLabel(rest: string): string | null {
  if (rest === "") return null;
  if (rest.startsWith("insights")) return "Insights";
  if (rest.startsWith("activity")) return "Activity";
  const preview = /^storybook-previews\/(\d+)/.exec(rest);
  if (preview) return `Component capture run ${preview[1]}`;
  const run = /^test-runs\/(\d+)/.exec(rest);
  if (run) return `Playwright run ${run[1]}`;
  if (rest.startsWith("pulls")) return "Pull requests";
  if (rest.startsWith("policy")) return "Policy";
  if (rest.startsWith("compare")) return "Compare";
  const upload = /^u\/(\d+)/.exec(rest);
  if (upload) return `upload ${upload[1]}`;
  const pr = /^pr\/(\d+)/.exec(rest);
  if (pr) return `PR #${pr[1]}`;
  return null;
}

const LAST_ORG_KEY = "covallaby-last-org";

/** The org an app path is scoped to: `/o/:owner` or `/r/:owner/...` — null elsewhere. */
export function orgFromPathname(pathname: string): string | null {
  const match = /^\/[or]\/([^/]+)/.exec(pathname);
  return match ? decodeURIComponent(match[1]!) : null;
}

/** The repo an app path is scoped to: `/r/:owner/:name/...` — null elsewhere. */
export function repoFromPathname(pathname: string): string | null {
  const match = /^\/r\/([^/]+)\/([^/]+)/.exec(pathname);
  return match ? `${decodeURIComponent(match[1]!)}/${decodeURIComponent(match[2]!)}` : null;
}

/** Header dropdown to jump to an org's overview (or all orgs). */
function OrgSwitcher({ repos }: { repos: RepoOverview[] }) {
  const owners = groupReposByOwner(repos).map((g) => g.owner);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const current = orgFromPathname(pathname);
  const [open, setOpen] = useState(false);
  if (owners.length < 2) return null;

  const pick = (org: string | null) => {
    setOpen(false);
    navigate(org ? `/o/${encodeURIComponent(org)}` : "/");
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-lg border border-(--border) bg-(--surface) px-2.5 py-1.5 text-[12.5px] text-(--ink-2) transition-colors hover:border-(--muted)"
      >
        {current ? (
          <>
            <OwnerAvatar owner={current} size={15} />
            <span className="max-w-[120px] truncate">{current}</span>
          </>
        ) : (
          <span>All orgs</span>
        )}
        <ChevronDown size={13} className="text-(--muted)" />
      </button>
      {open && (
        <>
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: click-away backdrop; Esc/Tab still work on the menu items */}
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="absolute right-0 z-40 mt-1 max-h-80 w-52 overflow-y-auto rounded-xl border border-(--border) bg-(--surface) p-1 shadow-[var(--shadow,0_10px_30px_-12px_rgba(0,0,0,.3))]">
            <button
              type="button"
              onClick={() => pick(null)}
              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] transition-colors hover:bg-(--surface-2) ${current === null ? "font-medium text-(--ink)" : "text-(--ink-2)"}`}
            >
              All orgs
            </button>
            {owners.map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => pick(o)}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] transition-colors hover:bg-(--surface-2) ${current === o ? "font-medium text-(--ink)" : "text-(--ink-2)"}`}
              >
                <OwnerAvatar owner={o} size={16} />
                <span className="min-w-0 truncate">{o}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export interface Crumb {
  label: string;
  /** Link target — absent on the trailing (current-page) crumb. */
  to?: string;
  /** Render in the mono font (repo names). */
  mono?: boolean;
}

/** The breadcrumb spine for a pathname: Overview / org / repo / section-or-entity. */
export function crumbTrail(pathname: string): Crumb[] {
  const crumbs: Crumb[] = [{ label: "Overview", to: "/" }];
  const org = /^\/o\/([^/]+)\/?$/.exec(pathname);
  if (org) {
    crumbs.push({ label: decodeURIComponent(org[1]!) });
    return crumbs;
  }
  const repo = /^\/r\/([^/]+)\/([^/]+)(?:\/(.*))?$/.exec(pathname);
  if (repo) {
    crumbs.push({ label: decodeURIComponent(repo[1]!), to: `/o/${repo[1]}` });
    crumbs.push({
      label: decodeURIComponent(repo[2]!),
      to: `/r/${repo[1]}/${repo[2]}`,
      mono: true,
    });
    const tail = tailLabel(repo[3] ?? "");
    if (tail) crumbs.push({ label: tail });
  }
  return crumbs;
}

function Crumbs() {
  const { pathname } = useLocation();
  const crumbs = crumbTrail(pathname);
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-[13px] text-(--muted)">
      {crumbs.map((crumb, i) => {
        // Keep the trailing two crumbs visible on mobile; the leading tiers collapse.
        const mobileHidden = i < crumbs.length - 2;
        // The separator disappears alongside the crumb before it.
        const prevHidden = i - 1 < crumbs.length - 2;
        const text = crumb.mono ? "font-mono text-[12.5px]" : "";
        return (
          <span
            key={crumb.to ?? crumb.label}
            className={`${mobileHidden ? "hidden sm:flex" : "flex"} min-w-0 items-center gap-1.5`}
          >
            {i > 0 && <span className={prevHidden ? "hidden sm:inline" : ""}>/</span>}
            {crumb.to ? (
              <Link to={crumb.to} className={`truncate hover:text-(--ink) ${text}`}>
                {crumb.label}
              </Link>
            ) : (
              <span className={`truncate text-(--ink-2) ${text || "text-[12.5px]"}`}>
                {crumb.label}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}

/** The all-orgs overview at `/` — redirects legacy `/?org=<owner>` links to `/o/:owner`. */
function HomeRoute({ repos }: { repos: RepoOverview[] | null }) {
  const [params] = useSearchParams();
  const org = params.get("org");
  if (org) return <Navigate to={`/o/${encodeURIComponent(org)}`} replace />;
  return <Home repos={repos} />;
}

/**
 * Legacy evidence-list routes (/uploads, /playbacks, /storybook-previews) live
 * on as deep links into the unified Activity tab — the query string (branch,
 * type, theme) rides along.
 */
export function RedirectToActivity() {
  const { owner, name } = useParams();
  const { search } = useLocation();
  return <Navigate to={{ pathname: `/r/${owner}/${name}/activity`, search }} replace />;
}

/** The app's route table. Every repo leaf lives under RepoLayout so the repo shell persists. */
export function buildRoutes(repos: RepoOverview[] | null): RouteObject[] {
  return [
    { path: "/", element: <HomeRoute repos={repos} /> },
    { path: "/o/:owner", element: <Home repos={repos} /> },
    {
      path: "/r/:owner/:name",
      element: <RepoLayout />,
      children: [
        { index: true, element: <Summary /> },
        { path: "commits", element: <Commits /> },
        { path: "activity", element: <Activity /> },
        { path: "insights", element: <Insights /> },
        { path: "uploads", element: <RedirectToActivity /> },
        { path: "u/:id", element: <Upload /> },
        { path: "playbacks", element: <RedirectToActivity /> },
        { path: "test-runs/:id", element: <PlaybackDetail /> },
        {
          path: "storybook-previews",
          children: [
            { index: true, element: <RedirectToActivity /> },
            { path: ":id", element: <StorybookPreviewDetail /> },
          ],
        },
        { path: "pulls", element: <PullRequests /> },
        { path: "pr/:pr", element: <PullRequest /> },
        { path: "compare", element: <CompareBranches /> },
        { path: "policy", element: <Policy /> },
      ],
    },
  ];
}

export function App() {
  const [theme, toggleTheme] = useTheme();
  const [repos, setRepos] = useState<RepoOverview[] | null>(null);
  const [me, setMe] = useState<Me | null | undefined>(undefined); // undefined = still loading
  const [githubApp, setGitHubApp] = useState<GitHubAppStatus | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { pathname, search } = useLocation();
  const routed = useRoutes(buildRoutes(repos));

  // "Needs attention" in the rail lands on Home with ?focus=review — bring the
  // review queue into view once it renders (it arrives after the repos fetch).
  useEffect(() => {
    if (pathname !== "/" || new URLSearchParams(search).get("focus") !== "review") return;
    let tries = 0;
    const timer = setInterval(() => {
      const target = [...document.querySelectorAll<HTMLElement>("main div")].find(
        (el) => el.childElementCount === 0 && el.textContent === "Needs attention",
      );
      if (target) {
        target.style.scrollMarginTop = "64px"; // clear the sticky header
        target.scrollIntoView({ block: "start" });
      }
      if (target || ++tries >= 20) clearInterval(timer);
    }, 100);
    return () => clearInterval(timer);
  }, [pathname, search]);

  useEffect(() => {
    void pathname;
    setMobileNavOpen(false);
  }, [pathname]);

  // Remember the last org overview visited so future sessions can pick up where you left off.
  useEffect(() => {
    const org = /^\/o\/([^/]+)/.exec(pathname);
    if (org) localStorage.setItem(LAST_ORG_KEY, decodeURIComponent(org[1]!));
  }, [pathname]);

  // Stamp repo visits so the sidebar's Recent section tracks where you actually work.
  useEffect(() => {
    const repo = repoFromPathname(pathname);
    if (repo) recordRepoVisit(repo);
  }, [pathname]);

  useEffect(() => {
    api
      .me()
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  const signedOut = me?.authenticated === false;

  useEffect(() => {
    if (!me?.authenticated) return;
    api
      .githubApp()
      .then(setGitHubApp)
      .catch(() => setGitHubApp(null));
  }, [me]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refetch on navigation keeps sidebar percentages fresh
  useEffect(() => {
    if (me === undefined || signedOut) return; // don't fetch coverage until we know we're allowed
    api
      .repos()
      .then((d) => setRepos(d.repos))
      .catch(() => setRepos([]));
  }, [pathname, me, signedOut]);

  if (me === undefined) return <div className="min-h-screen bg-(--page)" />; // brief, while auth resolves
  if (signedOut) return <SignIn theme={theme} toggleTheme={toggleTheme} />;

  return (
    <div className="min-h-screen">
      {IS_DEMO && (
        <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 bg-(--accent) px-4 py-1.5 text-center text-[12.5px] font-medium text-white">
          <span>🦘 Live demo — a snapshot of real data, fully clickable.</span>
          <a href="https://github.com/covallaby/covallaby" className="underline">
            Self-host it in one command →
          </a>
        </div>
      )}
      {mobileNavOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setMobileNavOpen(false)}
          className="fixed inset-0 z-30 bg-black/45 backdrop-blur-[1px] md:hidden"
        />
      )}
      <Sidebar
        repos={repos}
        me={me}
        githubApp={githubApp}
        mobileOpen={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
      />
      <div className="min-w-0 md:pl-60">
        <header className="sticky top-0 z-10 border-b border-(--hairline) bg-(--page)/80 backdrop-blur-md">
          <div className="flex items-center justify-between gap-2 px-4 py-2.5 sm:gap-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setMobileNavOpen(true)}
                aria-label="Open navigation"
                className="shrink-0 rounded-lg border border-(--border) bg-(--surface) p-1.5 text-(--ink-2) md:hidden"
              >
                <Menu size={17} />
              </button>
              <Crumbs />
            </div>
            <div className="flex items-center gap-3">
              {repos && repos.length > 0 && <OrgSwitcher repos={repos} />}
              <button
                type="button"
                onClick={toggleTheme}
                aria-label="Toggle theme"
                className="rounded-lg border border-(--border) bg-(--surface) p-1.5 text-(--ink-2) transition-colors hover:text-(--ink)"
              >
                {theme === "dark" ? (
                  <Sun size={15} strokeWidth={1.75} />
                ) : (
                  <Moon size={15} strokeWidth={1.75} />
                )}
              </button>
            </div>
          </div>
        </header>
        <main className="min-w-0 overflow-x-clip px-4 py-5 motion-safe:animate-[rise_.3s_cubic-bezier(.21,1.02,.73,1)] sm:px-6 sm:py-7">
          <style>{"@keyframes rise{from{opacity:0;transform:translateY(6px)}to{opacity:1}}"}</style>
          <div className="mx-auto min-w-0 max-w-5xl">{routed}</div>
        </main>
      </div>
    </div>
  );
}
