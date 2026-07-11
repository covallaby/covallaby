import { ChevronDown, Github, LayoutDashboard, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import {
  type GitHubAppStatus,
  IS_DEMO,
  type Me,
  type OwnerGroup,
  type RepoOverview,
  api,
  formatPercent,
  groupReposByOwner,
  severity,
  shortRepoName,
} from "./api.js";
import { Meter, OwnerAvatar, inkFor } from "./components/ui.js";
import { CompareBranches, PullRequest } from "./pages/Compare.js";
import { Home } from "./pages/Home.js";
import { PlaybackDetail, Playbacks } from "./pages/Playbacks.js";
import { Policy } from "./pages/Policy.js";
import { RepoLayout } from "./pages/Repo.js";
import { Insights } from "./pages/RepoInsights.js";
import { PullRequests } from "./pages/RepoPulls.js";
import { Summary } from "./pages/RepoSummary.js";
import { Uploads } from "./pages/RepoUploads.js";
import { Upload } from "./pages/Upload.js";

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

function SubLink({
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
      className={`rounded-md px-2.5 py-1 text-[12px] transition-colors ${
        active ? "font-medium text-(--ink)" : "text-(--muted) hover:text-(--ink)"
      }`}
    >
      {children}
    </Link>
  );
}

/** A repo in the rail: name + coverage %, a mini bar, and — when active — quick links. */
function RepoNavItem({ r, pathname }: { r: RepoOverview; pathname: string }) {
  const base = `/r/${r.repo}`;
  const active = pathname === base || pathname.startsWith(`${base}/`);
  return (
    <div>
      <Link
        to={base}
        className={`block rounded-lg px-2.5 py-2 transition-colors ${
          active ? "bg-(--accent-wash)" : "hover:bg-(--surface-2)"
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-(--ink-2)">
            {shortRepoName(r.repo)}
          </span>
          <span
            className={`text-[11px] font-semibold tabular-nums ${inkFor[severity(r.latest.percent)]}`}
          >
            {formatPercent(r.latest.percent)}
          </span>
        </div>
        <Meter percent={r.latest.percent} className="mt-1.5" />
      </Link>
      {active && (
        <div className="mt-0.5 mb-1 ml-3 flex flex-col items-start gap-0.5 border-l border-(--hairline) pl-2">
          <SubLink to={base} active={pathname === base || pathname.startsWith(`${base}/u/`)}>
            Summary
          </SubLink>
          <SubLink to={`${base}/insights`} active={pathname.startsWith(`${base}/insights`)}>
            Insights
          </SubLink>
          <SubLink to={`${base}/uploads`} active={pathname.startsWith(`${base}/uploads`)}>
            Uploads
          </SubLink>
          <SubLink
            to={`${base}/playbacks`}
            active={
              pathname.startsWith(`${base}/playbacks`) || pathname.startsWith(`${base}/test-runs/`)
            }
          >
            Playbacks
          </SubLink>
          <SubLink
            to={`${base}/pulls`}
            active={pathname.startsWith(`${base}/pulls`) || pathname.startsWith(`${base}/pr/`)}
          >
            Pull requests
          </SubLink>
          <SubLink to={`${base}/policy`} active={pathname.startsWith(`${base}/policy`)}>
            Policy
          </SubLink>
        </div>
      )}
    </div>
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

/** A collapsible org/owner section in the rail: avatar + name + repo count. */
function OrgSection({ group, pathname }: { group: OwnerGroup; pathname: string }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="mt-1.5 first:mt-0">
      <div className="flex items-center gap-1">
        <Link
          to={`/?org=${encodeURIComponent(group.owner)}`}
          title={`${group.owner} overview`}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-(--surface-2)"
        >
          <OwnerAvatar owner={group.owner} size={16} />
          <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{group.owner}</span>
          <span className="text-[10.5px] tabular-nums text-(--muted)">{group.repos.length}</span>
        </Link>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? "Collapse" : "Expand"}
          className="shrink-0 rounded-lg p-1.5 transition-colors hover:bg-(--surface-2)"
        >
          <ChevronDown
            size={13}
            className={`text-(--muted) transition-transform ${open ? "" : "-rotate-90"}`}
          />
        </button>
      </div>
      {open && (
        <div className="mt-0.5 ml-[15px] space-y-0.5 border-l border-(--hairline) pl-2">
          {group.repos.map((r) => (
            <RepoNavItem key={r.repo} r={r} pathname={pathname} />
          ))}
        </div>
      )}
    </div>
  );
}

function Sidebar({
  repos,
  me,
  githubApp,
}: { repos: RepoOverview[] | null; me: Me | null; githubApp: GitHubAppStatus | null }) {
  const { pathname } = useLocation();
  return (
    <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 flex-col border-r border-(--hairline) bg-(--surface) md:flex">
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
        <Mark />
        <div>
          <div className="text-[14px] leading-tight font-semibold tracking-tight">Covallaby</div>
          <div className="text-[11px] text-(--muted)">you’re covered 🌿</div>
        </div>
      </div>
      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-3">
        <div className="space-y-0.5">
          <SidebarLink to="/" active={pathname === "/"}>
            <LayoutDashboard size={15} strokeWidth={1.75} /> Overview
          </SidebarLink>
        </div>
        <div>
          <div className="px-2.5 pb-1.5 text-[10.5px] font-semibold tracking-widest text-(--muted) uppercase">
            Repositories
          </div>
          <div className="space-y-0.5">
            {repos === null && (
              <div className="space-y-2.5 px-2.5 py-1">
                <div className="h-8 animate-pulse rounded bg-(--surface-2)" />
                <div className="h-8 animate-pulse rounded bg-(--surface-2)" />
              </div>
            )}
            {repos?.length
              ? groupReposByOwner(repos).map((group) => (
                  <OrgSection key={group.owner} group={group} pathname={pathname} />
                ))
              : null}
            {repos?.length === 0 && (
              <p className="px-2.5 py-1 text-[12px] text-(--muted)">Nothing uploaded yet.</p>
            )}
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

/** Label for the trailing path segment of a repo route (Uploads, PR #12, …). */
function tailLabel(rest: string): string | null {
  if (rest === "") return null;
  if (rest.startsWith("insights")) return "Insights";
  if (rest.startsWith("uploads")) return "Uploads";
  if (rest.startsWith("playbacks")) return "Playbacks";
  const run = /^test-runs\/(\d+)/.exec(rest);
  if (run) return `browser run ${run[1]}`;
  if (rest.startsWith("pulls")) return "Pull requests";
  if (rest.startsWith("policy")) return "Policy";
  if (rest.startsWith("compare")) return "Compare";
  const upload = /^u\/(\d+)/.exec(rest);
  if (upload) return `upload ${upload[1]}`;
  const pr = /^pr\/(\d+)/.exec(rest);
  if (pr) return `PR #${pr[1]}`;
  return null;
}

/** Header dropdown to scope the Overview to a single org (or all). */
function OrgSwitcher({ repos }: { repos: RepoOverview[] }) {
  const owners = groupReposByOwner(repos).map((g) => g.owner);
  const navigate = useNavigate();
  const { search } = useLocation();
  const current = new URLSearchParams(search).get("org");
  const [open, setOpen] = useState(false);
  if (owners.length < 2) return null;

  const pick = (org: string | null) => {
    setOpen(false);
    navigate(org ? `/?org=${encodeURIComponent(org)}` : "/");
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

function Crumbs() {
  const { pathname } = useLocation();
  const match = /^\/r\/([^/]+)\/([^/]+)(?:\/(.*))?$/.exec(pathname);
  const tail = match ? tailLabel(match[3] ?? "") : null;
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-[13px] text-(--muted)">
      <Link to="/" className="flex items-center gap-2 hover:text-(--ink) md:hidden">
        <Mark size={20} />
      </Link>
      <Link to="/" className="hover:text-(--ink)">
        Overview
      </Link>
      {match && (
        <>
          <span>/</span>
          <Link
            to={`/r/${match[1]}/${match[2]}`}
            className="truncate font-mono text-[12.5px] hover:text-(--ink)"
          >
            {match[1]}/{match[2]}
          </Link>
          {tail && (
            <>
              <span>/</span>
              <span className="text-[12.5px] text-(--ink-2)">{tail}</span>
            </>
          )}
        </>
      )}
    </div>
  );
}

export function App() {
  const [theme, toggleTheme] = useTheme();
  const [repos, setRepos] = useState<RepoOverview[] | null>(null);
  const [me, setMe] = useState<Me | null | undefined>(undefined); // undefined = still loading
  const [githubApp, setGitHubApp] = useState<GitHubAppStatus | null>(null);
  const { pathname } = useLocation();

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
      <Sidebar repos={repos} me={me} githubApp={githubApp} />
      <div className="md:pl-60">
        <header className="sticky top-0 z-10 border-b border-(--hairline) bg-(--page)/80 backdrop-blur-md">
          <div className="flex items-center justify-between gap-4 px-6 py-2.5">
            <Crumbs />
            <div className="flex items-center gap-3">
              {pathname === "/" && repos && repos.length > 0 && <OrgSwitcher repos={repos} />}
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
        <main className="px-6 py-7 motion-safe:animate-[rise_.3s_cubic-bezier(.21,1.02,.73,1)]">
          <style>{"@keyframes rise{from{opacity:0;transform:translateY(6px)}to{opacity:1}}"}</style>
          <div className="mx-auto max-w-5xl">
            <Routes>
              <Route path="/" element={<Home repos={repos} />} />
              <Route path="/r/:owner/:name" element={<RepoLayout />}>
                <Route index element={<Summary />} />
                <Route path="insights" element={<Insights />} />
                <Route path="uploads" element={<Uploads />} />
                <Route path="playbacks" element={<Playbacks />} />
                <Route path="pulls" element={<PullRequests />} />
                <Route path="policy" element={<Policy />} />
              </Route>
              <Route path="/r/:owner/:name/pr/:pr" element={<PullRequest />} />
              <Route path="/r/:owner/:name/compare" element={<CompareBranches />} />
              <Route path="/r/:owner/:name/u/:id" element={<Upload />} />
              <Route path="/r/:owner/:name/test-runs/:id" element={<PlaybackDetail />} />
            </Routes>
          </div>
        </main>
      </div>
    </div>
  );
}
