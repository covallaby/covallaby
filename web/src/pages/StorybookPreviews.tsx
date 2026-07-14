import {
  AlertCircle,
  BookOpen,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  GitCommit,
  GitPullRequest,
  Layers,
  RotateCw,
  Search,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  type BaselineInfo,
  type Neighbors,
  type StorybookCapture,
  type StorybookDiffSummary,
  type StorybookPreview,
  api,
} from "../api.js";
import { BaselineChip } from "../components/baseline-chip.js";
import { CommitStrip, commitHref, useCommitSiblings } from "../components/commit-strip.js";
import { LateralNav } from "../components/lateral-nav.js";
import { Card, CardHeader, Td, Th } from "../components/ui.js";
import { useRepo } from "./Repo.js";
import {
  type ReviewStop,
  type ReviewView,
  buildReviewStops,
  isEditableTarget,
  parseReviewFilter,
  parseReviewView,
  reviewKeyAction,
  stepStop,
  stopIndexOf,
} from "./storybook-review.js";

const when = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(iso),
  );

export function StorybookPreviews() {
  const { repo, data } = useRepo();
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
                      <Link
                        className="font-mono text-xs hover:underline"
                        to={commitHref(repo, preview.commit, data.history)}
                        title="Open this commit in Covallaby"
                      >
                        {preview.commit.slice(0, 10)}
                      </Link>
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

const statusTone: Record<StorybookCapture["status"], string> = {
  changed: "bg-(--warn)/12 text-(--warn)",
  new: "bg-(--good)/12 text-(--good)",
  removed: "bg-(--bad)/12 text-(--bad)",
  unchanged: "bg-(--surface-2) text-(--muted)",
  uncompared: "bg-(--accent-wash) text-(--accent)",
};

export function StorybookPreviewDetail() {
  const { id } = useParams();
  const [data, setData] = useState<{
    run: StorybookPreview;
    previewUrl: string;
    baselineRun: StorybookPreview | null;
    baseline?: BaselineInfo;
    neighbors?: Neighbors<StorybookPreview>;
    summary: StorybookDiffSummary;
    captures: StorybookCapture[];
  } | null>(null);
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [request, setRequest] = useState(0);
  const [query, setQuery] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  const [overlay, setOverlay] = useState(50);
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(new Set());
  // Where `d` returns to when the diff view toggles back off.
  const previousViewRef = useRef<Exclude<ReviewView, "diff">>("side-by-side");

  // Shareable review state lives in the URL: ?filter= (changed-only vs. all),
  // ?view= (diff mode), ?story= (selected capture).
  const filter = parseReviewFilter(searchParams.get("filter"));
  const view = parseReviewView(searchParams.get("view"));
  const storyParam = searchParams.get("story");
  const paramDefaults: Record<string, string> = { filter: "changes", view: "side-by-side" };
  const setParam = (key: "filter" | "view" | "story", value: string | null) => {
    setSearchParams(
      (params) => {
        const next = new URLSearchParams(params);
        if (value === null || value === paramDefaults[key]) next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true },
    );
  };
  const setView = (mode: ReviewView) => {
    if (mode !== "diff") previousViewRef.current = mode;
    setParam("view", mode);
  };

  useEffect(() => {
    void request;
    setData(null);
    setError(null);
    api
      .storybookPreview(id!)
      .then((result) => setData(result))
      .catch((reason) => setError(String(reason)));
  }, [id, request]);
  const siblings = useCommitSiblings(data?.run.repo, data?.run.commit);

  const stops = data ? buildReviewStops(data.captures, filter, query) : [];
  const selected =
    (storyParam ? data?.captures.find((capture) => capture.id === storyParam) : null) ??
    stops[0]?.captures[0] ??
    null;
  const selectedStop = stops[stopIndexOf(stops, selected?.id ?? null)] ?? null;

  // Keyboard-first review loop. Re-registered every render so the handler
  // always closes over current stops/selection; cleanup keeps it single.
  useEffect(() => {
    if (!data) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // [ / ] jump laterally to the previous / next capture run.
      if (event.key === "[" || event.key === "]") {
        if (isEditableTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey)
          return;
        const target = event.key === "[" ? data.neighbors?.prev : data.neighbors?.next;
        if (!target) return;
        event.preventDefault();
        navigate(`/r/${data.run.repo}/storybook-previews/${target.id}`);
        return;
      }
      const action = reviewKeyAction(event.key, {
        editable: isEditableTarget(event.target),
        modifier: event.metaKey || event.ctrlKey || event.altKey,
      });
      if (!action) return;
      event.preventDefault();
      if (action === "next" || action === "prev") {
        const target = stepStop(stops, selected?.id ?? null, action === "next" ? 1 : -1);
        if (target) setParam("story", target.id);
      } else if (action === "toggle-diff") {
        if (!selected?.diffImageUrl) return;
        setParam("view", view === "diff" ? previousViewRef.current : "diff");
      } else if (action === "swap") {
        if (!selected?.baselineImageUrl || !selected.imageUrl) return;
        setParam("view", "overlay");
        setOverlay((value) => (value === 0 ? 100 : 0));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

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
  const actionable = data.summary.changed + data.summary.new + data.summary.removed;
  const groupCount = stops.filter((stop) => stop.captures.length > 1).length;
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
            <Link
              to={
                siblings?.upload
                  ? `/r/${data.run.repo}/u/${siblings.upload.id}`
                  : `/r/${data.run.repo}/commits`
              }
              title="Open this commit in Covallaby"
              className="hover:text-(--ink) hover:underline"
            >
              {data.run.commit}
            </Link>{" "}
            · {when(data.run.createdAt)}
          </p>
          <div className="mt-2">
            <BaselineChip baseline={data.baseline} />
          </div>
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
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <CommitStrip
            repo={data.run.repo}
            commit={data.run.commit}
            pr={data.run.pr}
            current="components"
            siblings={siblings}
          />
        </div>
        <LateralNav
          noun="run"
          prev={
            data.neighbors?.prev
              ? {
                  to: `/r/${data.run.repo}/storybook-previews/${data.neighbors.prev.id}`,
                  title: `${data.neighbors.prev.commit.slice(0, 10)} on ${data.neighbors.prev.branch}`,
                }
              : null
          }
          next={
            data.neighbors?.next
              ? {
                  to: `/r/${data.run.repo}/storybook-previews/${data.neighbors.next.id}`,
                  title: `${data.neighbors.next.commit.slice(0, 10)} on ${data.neighbors.next.branch}`,
                }
              : null
          }
        />
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
                  onClick={() => setParam("filter", status)}
                  className="px-4 py-3 text-left hover:bg-(--surface-2)"
                >
                  <span className="block text-lg font-semibold">{count}</span>
                  <span className="text-xs capitalize text-(--muted)">{status}</span>
                </button>
              ))}
            </div>
            <div className="border-t border-(--hairline) px-4 py-3 text-xs text-(--muted)">
              {data.baselineRun
                ? `${actionable} reviewable change${actionable === 1 ? "" : "s"} against main ${data.baselineRun.commit.slice(0, 9)}${groupCount > 0 ? ` · ${groupCount} identical-diff group${groupCount === 1 ? "" : "s"}` : ""}`
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
                    {selectedStop && selectedStop.captures.length > 1 ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-(--accent-wash) px-2 py-0.5 text-[11px] text-(--accent)">
                        <Layers size={11} /> same change as {selectedStop.captures.length - 1} other
                        {selectedStop.captures.length === 2 ? "" : "s"}
                      </span>
                    ) : null}
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
                    <div className="mx-auto mt-4 w-full max-w-lg">
                      <input
                        aria-label="Current image visibility"
                        type="range"
                        min="0"
                        max="100"
                        value={overlay}
                        onChange={(event) => setOverlay(Number(event.target.value))}
                        className="block w-full"
                      />
                      <div className="mt-1 flex justify-between text-[11px] text-(--muted)">
                        <span>Baseline</span>
                        <span>Current</span>
                      </div>
                    </div>
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
              <button
                type="button"
                onClick={() => setParam("filter", filter === "all" ? "changes" : "all")}
                className="rounded-lg border border-(--border) bg-(--surface) px-3 py-2 text-sm font-medium hover:border-(--muted)"
              >
                {filter === "all"
                  ? `Changes only (${actionable})`
                  : `Show all (${data.captures.length})`}
              </button>
              <select
                aria-label="Capture filter"
                value={filter}
                onChange={(event) => setParam("filter", event.target.value)}
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
            <div className="mt-3 hidden flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-(--muted) sm:flex">
              <span>
                <Kbd>j</Kbd>/<Kbd>k</Kbd> or <Kbd>↑</Kbd>/<Kbd>↓</Kbd> next / prev
              </span>
              <span>
                <Kbd>d</Kbd> toggle pixel diff
              </span>
              <span>
                <Kbd>b</Kbd> flip baseline ↔ new
              </span>
              <span>
                <Kbd>[</Kbd>/<Kbd>]</Kbd> previous / next run
              </span>
            </div>
          </Card>
          {stops.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {stops.map((stop) => (
                <ReviewStopCard
                  key={stop.key}
                  stop={stop}
                  selectedId={selected?.id ?? null}
                  active={selectedStop?.key === stop.key}
                  expanded={expandedGroups.has(stop.key)}
                  onSelect={(captureId) => setParam("story", captureId)}
                  onToggleExpanded={() =>
                    setExpandedGroups((current) => {
                      const next = new Set(current);
                      if (next.has(stop.key)) next.delete(stop.key);
                      else next.add(stop.key);
                      return next;
                    })
                  }
                />
              ))}
            </div>
          ) : (
            <Card className="p-6 text-center text-sm text-(--muted)">
              {filter === "changes" && query.trim() === "" ? (
                <>
                  No visual changes to review.{" "}
                  <button
                    type="button"
                    onClick={() => setParam("filter", "all")}
                    className="font-medium text-(--accent) hover:underline"
                  >
                    Show all ({data.captures.length})
                  </button>
                </>
              ) : (
                <>No component captures match “{query}”.</>
              )}
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

/**
 * One stop in the review loop: a single capture, or a group of stories that
 * share the exact same visual change and review together.
 */
function ReviewStopCard({
  stop,
  selectedId,
  active,
  expanded,
  onSelect,
  onToggleExpanded,
}: {
  stop: ReviewStop;
  selectedId: string | null;
  active: boolean;
  expanded: boolean;
  onSelect: (captureId: string) => void;
  onToggleExpanded: () => void;
}) {
  const representative =
    stop.captures.find((capture) => capture.id === selectedId) ?? stop.captures[0]!;
  const isGroup = stop.captures.length > 1;
  return (
    <Card
      className={`group overflow-hidden transition-colors ${active ? "border-(--accent)" : ""}`}
    >
      <button
        type="button"
        onClick={() => onSelect(representative.id)}
        className="block w-full text-left"
      >
        <div className="block bg-[linear-gradient(45deg,var(--surface-2)_25%,transparent_25%),linear-gradient(-45deg,var(--surface-2)_25%,transparent_25%),linear-gradient(45deg,transparent_75%,var(--surface-2)_75%),linear-gradient(-45deg,transparent_75%,var(--surface-2)_75%)] bg-size-[18px_18px] bg-position-[0_0,0_9px,9px_-9px,-9px_0] p-3">
          <img
            src={representative.imageUrl || representative.baselineImageUrl}
            alt={`${representative.title} — ${representative.name}`}
            loading="lazy"
            className="mx-auto h-52 w-full rounded-md bg-white object-contain shadow-sm transition-transform group-hover:scale-[1.01]"
          />
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-(--hairline) px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-xs text-(--muted)">{representative.title}</p>
            <p className="mt-0.5 truncate text-sm font-medium">{representative.name}</p>
          </div>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] capitalize ${statusTone[representative.status]}`}
          >
            {representative.status}
          </span>
        </div>
      </button>
      {isGroup ? (
        <div className="border-t border-(--hairline)">
          <button
            type="button"
            onClick={onToggleExpanded}
            className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-xs font-medium text-(--accent) hover:bg-(--surface-2)"
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <Layers size={13} /> {stop.captures.length} stories with this same change
          </button>
          {expanded ? (
            <ul className="border-t border-(--hairline)">
              {stop.captures.map((capture) => (
                <li key={capture.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(capture.id)}
                    className={`flex w-full items-baseline gap-2 px-4 py-2 text-left text-xs hover:bg-(--surface-2) ${capture.id === selectedId ? "bg-(--accent-wash)" : ""}`}
                  >
                    <span className="text-(--muted)">{capture.title}</span>
                    <span className="font-medium">{capture.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-(--border) bg-(--surface-2) px-1 py-0.5 font-mono text-[10px]">
      {children}
    </kbd>
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
