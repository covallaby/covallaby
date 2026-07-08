import { Link, Route, Routes, useLocation } from "react-router-dom";
import { Home } from "./pages/Home.js";
import { Repo } from "./pages/Repo.js";
import { Upload } from "./pages/Upload.js";

function Mark({ size = 26 }: { size?: number }) {
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

function Crumbs() {
  const { pathname } = useLocation();
  const match = /^\/r\/([^/]+)\/([^/]+)(?:\/u\/(\d+))?/.exec(pathname);
  if (!match) return null;
  const repo = `${match[1]}/${match[2]}`;
  return (
    <span className="text-[13.5px] text-(--muted)">
      /{" "}
      <Link className="hover:text-(--ink)" to="/">
        repos
      </Link>{" "}
      /{" "}
      {match[3] ? (
        <>
          <Link className="hover:text-(--ink)" to={`/r/${repo}`}>
            {repo}
          </Link>{" "}
          / <span className="font-mono text-[12.5px]">upload {match[3]}</span>
        </>
      ) : (
        <span>{repo}</span>
      )}
    </span>
  );
}

export function App() {
  return (
    <div className="min-h-screen">
      <nav className="sticky top-0 z-10 border-b border-(--hairline) bg-(--page)/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-6 py-3">
          <Link
            to="/"
            className="flex items-center gap-2.5 text-[15px] font-semibold tracking-tight"
          >
            <Mark /> Covallaby
          </Link>
          <Crumbs />
        </div>
      </nav>
      <main className="mx-auto max-w-5xl px-6 pt-9 pb-16 motion-safe:animate-[rise_.35s_cubic-bezier(.21,1.02,.73,1)]">
        <style>{"@keyframes rise{from{opacity:0;transform:translateY(6px)}to{opacity:1}}"}</style>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/r/:owner/:name" element={<Repo />} />
          <Route path="/r/:owner/:name/u/:id" element={<Upload />} />
        </Routes>
      </main>
      <footer className="mx-auto flex max-w-5xl items-center gap-2 px-6 pb-10 text-[12.5px] text-(--muted)">
        <Mark size={15} /> Beautiful coverage reports for your pull requests.
      </footer>
    </div>
  );
}
