import {
  AlertCircle,
  BookOpen,
  ExternalLink,
  GitCommit,
  GitPullRequest,
  RotateCw,
  Search,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  type StorybookCapture,
  type StorybookDiffSummary,
  type StorybookPreview,
  api,
} from "../api.js";
import { Card, CardHeader, Td, Th } from "../components/ui.js";
import { useRepo } from "./Repo.js";

const when = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(iso),
  );

export function StorybookPreviews() {
  const { repo } = useRepo();
  const [previews, setPreviews] = useState<StorybookPreview[] | null>(null);
  const [error, setError] = useState(false);
  const [request, setRequest] = useState(0);
  useEffect(() => {
    void request;
    setPreviews(null);
    setError(false);
    api
      .storybookPreviews(repo)
      .then((result) => setPreviews(result.previews))
      .catch(() => setError(true));
  }, [repo, request]);
  return (
    <Card>
      <CardHeader
        title="Component captures"
        description="Review the exact component experience built by CI before it reaches production."
      />
      {error ? (
        <div className="mx-5 mb-5 flex items-start justify-between gap-4 rounded-xl border border-(--bad)/25 bg-(--bad)/5 p-4">
          <div className="flex gap-3">
            <AlertCircle className="mt-0.5 shrink-0 text-(--bad)" size={18} />
            <div>
              <p className="text-sm font-medium">We couldn't load component captures.</p>
              <p className="mt-1 text-xs text-(--muted)">
                Your previews are still safe. Check the connection and try again.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setRequest((value) => value + 1)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-(--border) bg-(--surface) px-2.5 py-1.5 text-xs font-medium hover:border-(--muted)"
          >
            <RotateCw size={13} /> Retry
          </button>
        </div>
      ) : !previews ? (
        <p className="px-5 pb-5 text-sm text-(--muted)">Loading previews…</p>
      ) : previews.length === 0 ? (
        <p className="px-5 pb-6 text-sm text-(--muted)">
          No previews yet. Upload a Storybook build with the Covallaby Action to publish the first
          one.
        </p>
      ) : (
        <>
          <div className="space-y-2 px-3 pb-3 md:hidden">
            {previews.map((preview) => (
              <Link
                key={preview.id}
                to={`/r/${repo}/storybook-previews/${preview.id}`}
                className="flex items-start gap-3 rounded-xl border border-(--border) bg-(--surface-2)/45 p-3.5 active:bg-(--surface-2)"
              >
                <BookOpen className="mt-0.5 shrink-0 text-(--accent)" size={18} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0 truncate text-sm font-medium">
                      {preview.pr ? `PR #${preview.pr}` : preview.branch}
                    </span>
                    <span className="shrink-0 rounded-full bg-(--accent-wash) px-2 py-0.5 text-[10px] font-medium text-(--accent)">
                      {preview.status === "complete" ? "Ready" : "Publishing"}
                    </span>
                  </div>
                  <p className="mt-1 truncate font-mono text-[11px] text-(--muted)">
                    {preview.commit.slice(0, 10)}
                  </p>
                  <p className="mt-2 text-xs text-(--muted)">{when(preview.createdAt)}</p>
                </div>
              </Link>
            ))}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[680px] text-[13.5px]">
              <thead>
                <tr>
                  <Th>Preview</Th>
                  <Th>Commit</Th>
                  <Th>Branch</Th>
                  <Th>Published</Th>
                </tr>
              </thead>
              <tbody>
                {previews.map((preview) => (
                  <tr key={preview.id} className="hover:bg-(--surface-2)">
                    <Td>
                      <Link
                        className="font-medium hover:underline"
                        to={`/r/${repo}/storybook-previews/${preview.id}`}
                      >
                        <BookOpen className="mr-2 inline text-(--accent)" size={16} />
                        {preview.pr ? `PR #${preview.pr} preview` : `${preview.branch} preview`}
                      </Link>
                    </Td>
                    <Td>
                      <span className="font-mono text-xs">{preview.commit.slice(0, 10)}</span>
                      <a
                        className="ml-2 inline-flex text-(--muted) hover:text-(--ink)"
                        href={`https://github.com/${repo}/commit/${preview.commit}`}
                        target="_blank"
                        rel="noreferrer"
                        aria-label="Open commit on GitHub"
                      >
                        <GitCommit size={14} />
                      </a>
                      {preview.pr ? (
                        <a
                          className="ml-2 inline-flex items-center gap-1 text-(--muted) hover:text-(--ink)"
                          href={`https://github.com/${repo}/pull/${preview.pr}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <GitPullRequest size={14} />#{preview.pr}
                        </a>
                      ) : null}
                    </Td>
                    <Td className="text-(--muted)">{preview.branch}</Td>
                    <Td className="text-(--muted)">{when(preview.createdAt)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

export function StorybookPreviewDetail() {
  const { id } = useParams();
  const [data, setData] = useState<{
    run: StorybookPreview;
    previewUrl: string;
    baselineRun: StorybookPreview | null;
    summary: StorybookDiffSummary;
    captures: StorybookCapture[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [request, setRequest] = useState(0);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"changes" | StorybookCapture["status"] | "all">("changes");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<"side-by-side" | "overlay" | "diff">("side-by-side");
  const [overlay, setOverlay] = useState(50);
  useEffect(() => {
    void request;
    setData(null);
    setError(null);
    api
      .storybookPreview(id!)
      .then((result) => {
        setData(result);
        setSelectedId(
          result.captures.find((capture) => capture.status !== "unchanged")?.id ??
            result.captures[0]?.id ??
            null,
        );
      })
      .catch((reason) => setError(String(reason)));
  }, [id, request]);
  if (error)
    return (
      <div className="rounded-xl border border-(--bad)/25 bg-(--bad)/5 p-5">
        <p className="text-sm font-medium text-(--bad)">This preview couldn't be opened.</p>
        <p className="mt-1 text-xs text-(--muted)">
          Its secure link may have expired, or the preview may no longer be retained.
        </p>
        <button
          type="button"
          onClick={() => setRequest((value) => value + 1)}
          className="mt-4 inline-flex items-center gap-2 rounded-lg border border-(--border) bg-(--surface) px-3 py-2 text-xs font-medium"
        >
          <RotateCw size={14} /> Request a fresh link
        </button>
      </div>
    );
  if (!data) return <p className="text-sm text-(--muted)">Loading component captures…</p>;
  const captures = data.captures.filter((capture) => {
    const matchesQuery = `${capture.title} ${capture.name}`
      .toLowerCase()
      .includes(query.trim().toLowerCase());
    const matchesFilter =
      filter === "all" ||
      (filter === "changes"
        ? capture.status === "changed" || capture.status === "new" || capture.status === "removed"
        : capture.status === filter);
    return matchesQuery && matchesFilter;
  });
  const selected = data.captures.find((capture) => capture.id === selectedId) ?? null;
  const actionable = data.summary.changed + data.summary.new + data.summary.removed;
  const statusTone: Record<StorybookCapture["status"], string> = {
    changed: "bg-(--warn)/12 text-(--warn)",
    new: "bg-(--good)/12 text-(--good)",
    removed: "bg-(--bad)/12 text-(--bad)",
    unchanged: "bg-(--surface-2) text-(--muted)",
    uncompared: "bg-(--accent-wash) text-(--accent)",
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <Link
            to={`/r/${data.run.repo}/storybook-previews`}
            className="text-xs text-(--muted) hover:text-(--ink)"
          >
            ← All component captures
          </Link>
          <h1 className="mt-2 text-xl font-semibold">
            {data.run.pr ? `PR #${data.run.pr}` : data.run.branch} component captures
          </h1>
          <p className="mt-1 font-mono text-xs text-(--muted)">
            {data.run.commit} · {when(data.run.createdAt)}
          </p>
        </div>
        {data.run.status === "complete" ? (
          <a
            href={data.previewUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-(--border) bg-(--surface) px-3 py-2 text-xs font-medium hover:border-(--muted)"
          >
            Open interactive Storybook <ExternalLink size={14} />
          </a>
        ) : (
          <span className="rounded-full bg-(--accent-wash) px-3 py-1.5 text-xs font-medium text-(--accent)">
            Publishing…
          </span>
        )}
      </div>
      {data.run.status === "complete" && data.captures.length > 0 ? (
        <>
          <Card className="overflow-hidden">
            <div className="grid grid-cols-2 divide-x divide-(--hairline) sm:grid-cols-5">
              {(
                [
                  ["changed", data.summary.changed],
                  ["new", data.summary.new],
                  ["removed", data.summary.removed],
                  ["unchanged", data.summary.unchanged],
                  ["uncompared", data.summary.uncompared],
                ] as const
              ).map(([status, count]) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setFilter(status)}
                  className="px-4 py-3 text-left hover:bg-(--surface-2)"
                >
                  <span className="block text-lg font-semibold">{count}</span>
                  <span className="text-xs capitalize text-(--muted)">{status}</span>
                </button>
              ))}
            </div>
            <div className="border-t border-(--hairline) px-4 py-3 text-xs text-(--muted)">
              {data.baselineRun
                ? `${actionable} reviewable change${actionable === 1 ? "" : "s"} against main ${data.baselineRun.commit.slice(0, 9)}`
                : "No earlier main capture is available yet; this run will establish visual history."}
            </div>
          </Card>
          {selected ? (
            <Card className="overflow-hidden">
              <div className="flex flex-col gap-3 border-b border-(--hairline) p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="font-medium">{selected.name}</h2>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] capitalize ${statusTone[selected.status]}`}
                    >
                      {selected.status}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-(--muted)">{selected.title}</p>
                </div>
                {selected.baselineImageUrl && selected.imageUrl ? (
                  <div className="flex rounded-lg border border-(--border) bg-(--surface-2) p-1 text-xs">
                    {(["side-by-side", "overlay", "diff"] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        disabled={mode === "diff" && !selected.diffImageUrl}
                        onClick={() => setView(mode)}
                        className={`rounded-md px-2.5 py-1.5 capitalize disabled:opacity-35 ${view === mode ? "bg-(--surface) text-(--ink) shadow-sm" : "text-(--muted)"}`}
                      >
                        {mode.replace("-", " ")}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="bg-(--surface-2) p-3 sm:p-5">
                {view === "diff" && selected.diffImageUrl ? (
                  <ReviewImage
                    src={selected.diffImageUrl}
                    alt={`Pixel diff for ${selected.name}`}
                    label="Pixel diff"
                  />
                ) : view === "overlay" && selected.baselineImageUrl && selected.imageUrl ? (
                  <div>
                    <div className="relative mx-auto max-w-5xl overflow-hidden rounded-lg border border-(--border) bg-white">
                      <img
                        src={selected.baselineImageUrl}
                        alt={`Baseline ${selected.name}`}
                        className="block w-full"
                      />
                      <img
                        src={selected.imageUrl}
                        alt={`Current ${selected.name}`}
                        className="absolute inset-0 h-full w-full border-r-2 border-white/80 object-contain"
                        style={{ clipPath: `inset(0 ${100 - overlay}% 0 0)` }}
                      />
                    </div>
                    <input
                      aria-label="Current image visibility"
                      type="range"
                      min="0"
                      max="100"
                      value={overlay}
                      onChange={(event) => setOverlay(Number(event.target.value))}
                      className="mx-auto mt-4 block w-full max-w-lg"
                    />
                  </div>
                ) : selected.baselineImageUrl && selected.imageUrl ? (
                  <div className="grid gap-4 lg:grid-cols-2">
                    <ReviewImage
                      src={selected.baselineImageUrl}
                      alt={`Baseline ${selected.name}`}
                      label="Baseline · main"
                    />
                    <ReviewImage
                      src={selected.imageUrl}
                      alt={`Current ${selected.name}`}
                      label="Current · this run"
                    />
                  </div>
                ) : (
                  <ReviewImage
                    src={selected.imageUrl || selected.baselineImageUrl!}
                    alt={selected.name}
                    label={
                      selected.status === "removed"
                        ? "Removed · last seen on main"
                        : "New · this run"
                    }
                  />
                )}
              </div>
            </Card>
          ) : null}
          <Card className="p-3 sm:p-4">
            <div className="flex flex-col gap-3 sm:flex-row">
              <label className="relative block flex-1">
                <Search
                  size={15}
                  className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-(--muted)"
                />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={`Search ${data.captures.length} component captures`}
                  className="w-full rounded-lg border border-(--border) bg-(--surface-2) py-2 pr-3 pl-9 text-sm outline-none focus:border-(--muted)"
                />
              </label>
              <select
                aria-label="Capture filter"
                value={filter}
                onChange={(event) => setFilter(event.target.value as typeof filter)}
                className="rounded-lg border border-(--border) bg-(--surface-2) px-3 py-2 text-sm"
              >
                <option value="changes">Changes to review</option>
                <option value="all">All captures</option>
                <option value="changed">Changed</option>
                <option value="new">New</option>
                <option value="removed">Removed</option>
                <option value="unchanged">Unchanged</option>
                <option value="uncompared">Uncompared</option>
              </select>
            </div>
          </Card>
          {captures.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {captures.map((capture) => (
                <button
                  key={capture.id}
                  type="button"
                  onClick={() => setSelectedId(capture.id)}
                  className="text-left"
                >
                  <Card
                    className={`group overflow-hidden transition-colors ${selectedId === capture.id ? "border-(--accent)" : ""}`}
                  >
                    <div className="block bg-[linear-gradient(45deg,var(--surface-2)_25%,transparent_25%),linear-gradient(-45deg,var(--surface-2)_25%,transparent_25%),linear-gradient(45deg,transparent_75%,var(--surface-2)_75%),linear-gradient(-45deg,transparent_75%,var(--surface-2)_75%)] bg-size-[18px_18px] bg-position-[0_0,0_9px,9px_-9px,-9px_0] p-3">
                      <img
                        src={capture.imageUrl || capture.baselineImageUrl}
                        alt={`${capture.title} — ${capture.name}`}
                        loading="lazy"
                        className="mx-auto h-52 w-full rounded-md bg-white object-contain shadow-sm transition-transform group-hover:scale-[1.01]"
                      />
                    </div>
                    <div className="flex items-center justify-between gap-3 border-t border-(--hairline) px-4 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-xs text-(--muted)">{capture.title}</p>
                        <p className="mt-0.5 truncate text-sm font-medium">{capture.name}</p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] capitalize ${statusTone[capture.status]}`}
                      >
                        {capture.status}
                      </span>
                    </div>
                  </Card>
                </button>
              ))}
            </div>
          ) : (
            <Card className="p-6 text-center text-sm text-(--muted)">
              No component captures match “{query}”.
            </Card>
          )}
        </>
      ) : data.run.status === "complete" ? (
        <Card className="p-6">
          <div className="flex items-start gap-3">
            <BookOpen size={20} className="mt-0.5 shrink-0 text-(--accent)" />
            <div>
              <p className="text-sm font-medium">This older run has no individual captures.</p>
              <p className="mt-1 text-xs text-(--muted)">
                Its interactive Storybook is still available. New runs captured by the Covallaby
                Action will appear here as a searchable image gallery.
              </p>
            </div>
          </div>
        </Card>
      ) : (
        <Card className="p-6">
          <p className="text-sm font-medium">This preview is still publishing.</p>
          <p className="mt-1 text-xs text-(--muted)">
            Covallaby will make it available as soon as every Storybook asset finishes uploading.
          </p>
        </Card>
      )}
    </div>
  );
}

function ReviewImage({ src, alt, label }: { src: string; alt: string; label: string }) {
  return (
    <figure>
      <figcaption className="mb-2 text-xs font-medium text-(--muted)">{label}</figcaption>
      <a
        href={src}
        target="_blank"
        rel="noreferrer"
        className="block overflow-hidden rounded-lg border border-(--border) bg-white"
      >
        <img
          src={src}
          alt={alt}
          className="mx-auto max-h-[620px] w-auto max-w-full object-contain"
        />
      </a>
    </figure>
  );
}
