import { Github, LayoutDashboard, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, Route, Routes, useLocation } from "react-router-dom";
import { IS_DEMO, type RepoOverview, api, formatPercent, severity } from "./api.js";
import { Meter, inkFor } from "./components/ui.js";
import { CompareBranches, PullRequest } from "./pages/Compare.js";
import { Home } from "./pages/Home.js";
import { Policy } from "./pages/Policy.js";
import { RepoLayout } from "./pages/Repo.js";
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
            {r.repo}
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
          <SubLink to={`${base}/uploads`} active={pathname.startsWith(`${base}/uploads`)}>
            Uploads
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

function Sidebar({ repos }: { repos: RepoOverview[] | null }) {
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
            {repos?.map((r) => (
              <RepoNavItem key={r.repo} r={r} pathname={pathname} />
            ))}
            {repos?.length === 0 && (
              <p className="px-2.5 py-1 text-[12px] text-(--muted)">Nothing uploaded yet.</p>
            )}
          </div>
        </div>
      </nav>
      <div className="border-t border-(--hairline) px-3 py-3">
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

/** Label for the trailing path segment of a repo route (Uploads, PR #12, …). */
function tailLabel(rest: string): string | null {
  if (rest === "") return null;
  if (rest.startsWith("uploads")) return "Uploads";
  if (rest.startsWith("pulls")) return "Pull requests";
  if (rest.startsWith("policy")) return "Policy";
  if (rest.startsWith("compare")) return "Compare";
  const upload = /^u\/(\d+)/.exec(rest);
  if (upload) return `upload ${upload[1]}`;
  const pr = /^pr\/(\d+)/.exec(rest);
  if (pr) return `PR #${pr[1]}`;
  return null;
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
  const { pathname } = useLocation();
  // biome-ignore lint/correctness/useExhaustiveDependencies: refetch on navigation keeps sidebar percentages fresh
  useEffect(() => {
    api
      .repos()
      .then((d) => setRepos(d.repos))
      .catch(() => setRepos([]));
  }, [pathname]);

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
      <Sidebar repos={repos} />
      <div className="md:pl-60">
        <header className="sticky top-0 z-10 border-b border-(--hairline) bg-(--page)/80 backdrop-blur-md">
          <div className="flex items-center justify-between gap-4 px-6 py-2.5">
            <Crumbs />
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
        </header>
        <main className="px-6 py-7 motion-safe:animate-[rise_.3s_cubic-bezier(.21,1.02,.73,1)]">
          <style>{"@keyframes rise{from{opacity:0;transform:translateY(6px)}to{opacity:1}}"}</style>
          <div className="mx-auto max-w-5xl">
            <Routes>
              <Route path="/" element={<Home repos={repos} />} />
              <Route path="/r/:owner/:name" element={<RepoLayout />}>
                <Route index element={<Summary />} />
                <Route path="uploads" element={<Uploads />} />
                <Route path="pulls" element={<PullRequests />} />
                <Route path="policy" element={<Policy />} />
              </Route>
              <Route path="/r/:owner/:name/pr/:pr" element={<PullRequest />} />
              <Route path="/r/:owner/:name/compare" element={<CompareBranches />} />
              <Route path="/r/:owner/:name/u/:id" element={<Upload />} />
            </Routes>
          </div>
        </main>
      </div>
    </div>
  );
}
