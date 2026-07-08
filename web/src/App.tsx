import { Github, LayoutDashboard, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, Route, Routes, useLocation } from "react-router-dom";
import { type RepoOverview, api, formatPercent, severity } from "./api.js";
import { inkFor } from "./components/ui.js";
import { Home } from "./pages/Home.js";
import { Repo } from "./pages/Repo.js";
import { Upload } from "./pages/Upload.js";

export function Mark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true">
      <rect width="512" height="512" rx="128" fill="var(--accent)" />
      <ellipse cx="256" cy="284" rx="130" ry="140" fill="#F4C48A" />
      <path d="M170 190 C130 96 150 60 205 132 Z" fill="#D9A066" />
      <path d="M342 190 C382 96 362 60 307 132 Z" fill="#D9A066" />
      <ellipse cx="216" cy="268" rx="14" ry="18" fill="#111827" />
      <ellipse cx="296" cy="268" rx="14" ry="18" fill="#111827" />
      <path
        d="M236 330 C248 342 264 342 276 330"
        stroke="#111827"
        strokeWidth="12"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
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
          ? "bg-(--surface-2) font-medium text-(--ink)"
          : "text-(--ink-2) hover:bg-(--surface-2) hover:text-(--ink)"
      }`}
    >
      {children}
    </Link>
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
          <div className="text-[11px] text-(--muted)">coverage that reads well</div>
        </div>
      </div>
      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-3">
        <div className="space-y-0.5">
          <SidebarLink to="/" active={pathname === "/"}>
            <LayoutDashboard size={15} strokeWidth={1.75} /> Dashboard
          </SidebarLink>
        </div>
        <div>
          <div className="px-2.5 pb-1.5 text-[10.5px] font-semibold tracking-widest text-(--muted) uppercase">
            Repositories
          </div>
          <div className="space-y-0.5">
            {repos === null && (
              <div className="space-y-1.5 px-2.5 py-1">
                <div className="h-3.5 animate-pulse rounded bg-(--surface-2)" />
                <div className="h-3.5 w-3/4 animate-pulse rounded bg-(--surface-2)" />
              </div>
            )}
            {repos?.map((r) => (
              <SidebarLink
                key={r.repo}
                to={`/r/${r.repo}`}
                active={pathname.startsWith(`/r/${r.repo}`)}
              >
                <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{r.repo}</span>
                <span
                  className={`text-[11px] font-semibold tabular-nums ${inkFor[severity(r.latest.percent)]}`}
                >
                  {formatPercent(r.latest.percent)}
                </span>
              </SidebarLink>
            ))}
            {repos?.length === 0 && (
              <p className="px-2.5 py-1 text-[12px] text-(--muted)">Nothing uploaded yet.</p>
            )}
          </div>
        </div>
      </nav>
      <div className="border-t border-(--hairline) px-3 py-3">
        <a
          href="https://github.com/covallaby/covallaby"
          className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] text-(--ink-2) transition-colors hover:bg-(--surface-2) hover:text-(--ink)"
        >
          <Github size={15} strokeWidth={1.75} /> covallaby/covallaby
        </a>
      </div>
    </aside>
  );
}

function Crumbs() {
  const { pathname } = useLocation();
  const match = /^\/r\/([^/]+)\/([^/]+)(?:\/u\/(\d+))?/.exec(pathname);
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-[13px] text-(--muted)">
      <Link to="/" className="flex items-center gap-2 hover:text-(--ink) md:hidden">
        <Mark size={20} />
      </Link>
      <Link to="/" className="hover:text-(--ink)">
        Dashboard
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
          {match[3] && (
            <>
              <span>/</span>
              <span className="font-mono text-[12.5px] text-(--ink-2)">upload {match[3]}</span>
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
              <Route path="/r/:owner/:name" element={<Repo />} />
              <Route path="/r/:owner/:name/u/:id" element={<Upload />} />
            </Routes>
          </div>
        </main>
      </div>
    </div>
  );
}
