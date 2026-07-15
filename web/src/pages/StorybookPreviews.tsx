import {
  AlertCircle,
  BookOpen,
  Bug,
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  GitCommit,
  GitPullRequest,
  Keyboard,
  Layers,
  RotateCcw,
  RotateCw,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  type CaptureReview,
  type CaptureReviewState,
  type StorybookPreviewDetail as PreviewDetailPayload,
  type StorybookCapture,
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
  nextPendingStop,
  parseReviewFilter,
  parseReviewView,
  reviewActionState,
  reviewKeyAction,
  reviewProgress,
  stepStop,
  stopIndexOf,
  stopReviewState,
} from "./storybook-review.js";

const when = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(iso),
  );

const statusTone: Record<StorybookCapture["status"], string> = {
  changed: "bg-(--warn)/12 text-(--warn)",
  new: "bg-(--good)/12 text-(--good)",
  removed: "bg-(--bad)/12 text-(--bad)",
  unchanged: "bg-(--surface-2) text-(--muted)",
  uncompared: "bg-(--accent-wash) text-(--accent)",
};

const reviewTone: Record<CaptureReviewState, string> = {
  pending: "bg-(--surface-2) text-(--muted)",
  approved: "bg-(--good)/12 text-(--good)",
  rejected: "bg-(--bad)/12 text-(--bad)",
  "auto-accepted": "bg-(--good)/12 text-(--good)",
  allowed: "bg-(--accent-wash) text-(--accent)",
  flaky: "bg-(--warn)/12 text-(--warn)",
};

/** Who reviewed and when — the chip tooltip and the inline byline. */
function reviewedByLine(review: CaptureReview): string | null {
  if (review.state === "pending") return null;
  if (review.state === "auto-accepted") return "Accepted automatically — default-branch build";
  const verb = {
    approved: "Approved",
    rejected: "Rejected",
    allowed: "Allowed across future diffs",
    flaky: "Marked flaky across future diffs",
  }[review.state];
  const who = review.reviewedBy ? ` by ${review.reviewedBy}` : "";
  const at = review.reviewedAt ? ` · ${when(review.reviewedAt)}` : "";
  const carried = review.carried ? " · carried over from an earlier run" : "";
  return `${verb}${who}${at}${carried}`;
}

function ReviewChip({ review }: { review: CaptureReview }) {
  return (
    <span
      title={reviewedByLine(review) ?? "Awaiting review"}
      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] capitalize ${reviewTone[review.state]}`}
    >
      {review.state}
    </span>
  );
}

type RuleDraft = {
  state: "allowed" | "flaky";
  tolerancePercent: string;
  note: string;
};

export function StorybookPreviewDetail() {
  const { id } = useParams();
  const [data, setData] = useState<PreviewDetailPayload | null>(null);
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [request, setRequest] = useState(0);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState(false);
  const [ruleDraft, setRuleDraft] = useState<RuleDraft | null>(null);
  const [ruleValidation, setRuleValidation] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  const [overlay, setOverlay] = useState(50);
  // Where `d` returns to when the diff view toggles back off.
  const previousViewRef = useRef<Exclude<ReviewView, "diff">>("side-by-side");

  // Shareable review state lives in the URL: ?filter= (changed-only vs. all),
  // ?view= (diff mode), ?story= (selected capture).
  const filter = parseReviewFilter(searchParams.get("filter"));
  const view = parseReviewView(searchParams.get("view"));
  const galleryMode = searchParams.get("mode") === "gallery";
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
  const selectedStopIndex = stopIndexOf(stops, selected?.id ?? null);
  const selectedStop = stops[selectedStopIndex] ?? null;
  const selectedId = selected?.id;

  useEffect(() => {
    // A draft belongs to one story; moving through the review queue closes it.
    void selectedId;
    setRuleDraft(null);
    setRuleValidation(null);
  }, [selectedId]);

  // Whether the current stop accepts a human verdict: reviewable captures on
  // a complete run that the server didn't auto-accept (mainline is read-only).
  const canReview =
    data !== null &&
    data.run.status === "complete" &&
    data.run.reviewState !== "auto-accepted" &&
    selectedStop !== null &&
    selectedStop.captures.every((capture) => capture.review);

  // Approve/reject/reset the whole stop — a group is one verdict covering
  // every member. The server answers with the fully re-derived payload.
  const submitReview = (action: "approve" | "reject" | "unreview") => {
    if (!data || !selectedStop || !canReview || reviewBusy) return;
    const current = stopReviewState(selectedStop)?.state;
    const state = reviewActionState(
      action,
      current === "approved" || current === "rejected" ? current : "pending",
    );
    const reviewedCaptureId = selected?.id ?? null;
    setReviewBusy(true);
    setReviewError(false);
    api
      .reviewCaptures(
        String(data.run.id),
        selectedStop.captures.map((capture) => capture.id),
        state,
      )
      .then((result) => {
        setReviewBusy(false);
        setData(result);
        if (state !== "pending") {
          const next = nextPendingStop(
            buildReviewStops(result.captures, filter, query),
            reviewedCaptureId,
          );
          if (next) setParam("story", next.id);
        }
      })
      .catch(() => {
        setReviewError(true);
        setReviewBusy(false);
      });
  };

  // Persistent exceptions are intentionally separate from approve/reject.
  // They carry a measured pixel tolerance forward to later runs and remain
  // visible as either understood variance or flaky test debt.
  const persistRule = (
    state: "allowed" | "flaky" | null,
    tolerancePercent?: number,
    note?: string,
  ) => {
    if (!data || !selected || !canReview || reviewBusy) return;
    const reviewedCaptureId = selected.id;
    setReviewBusy(true);
    setReviewError(false);
    setRuleValidation(null);
    api
      .setCaptureRule(String(data.run.id), {
        story: selected.id,
        state,
        tolerancePercent,
        note,
      })
      .then((result) => {
        setReviewBusy(false);
        setData(result);
        setRuleDraft(null);
        if (state !== null) {
          const next = nextPendingStop(
            buildReviewStops(result.captures, filter, query),
            reviewedCaptureId,
          );
          if (next) setParam("story", next.id);
        }
      })
      .catch(() => {
        setReviewError(true);
        setReviewBusy(false);
      });
  };

  const startRule = (state: "allowed" | "flaky") => {
    if (!selected || selected.changeRatio === undefined || reviewBusy) return;
    if (selected.rule?.state === state) {
      persistRule(null);
      return;
    }
    const currentPercent = selected.changeRatio * 100;
    const suggested = Math.min(100, Math.max(0.1, Math.round(currentPercent * 1.25 * 1000) / 1000));
    setRuleValidation(null);
    setRuleDraft({
      state,
      tolerancePercent: String(
        selected.rule?.toleranceRatio ? selected.rule.toleranceRatio * 100 : suggested,
      ),
      note: selected.rule?.note ?? "",
    });
  };

  const saveRule = () => {
    if (!ruleDraft) return;
    const tolerance = Number(ruleDraft.tolerancePercent);
    if (!Number.isFinite(tolerance) || tolerance <= 0 || tolerance > 100) {
      setRuleValidation("Enter a tolerance greater than 0 and no more than 100%.");
      return;
    }
    persistRule(ruleDraft.state, tolerance, ruleDraft.note);
  };

  // Keyboard-first review loop. Re-registered every render so the handler
  // always closes over current stops/selection; cleanup keeps it single.
  useEffect(() => {
    if (!data || galleryMode) return;
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
      } else if (action === "approve" || action === "reject" || action === "unreview") {
        submitReview(action);
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
  if (galleryMode) {
    return <ComponentCaptureGallery data={data} query={query} onQueryChange={setQuery} />;
  }
  const actionable = data.summary.changed + data.summary.new + data.summary.removed;
  const groupCount = stops.filter((stop) => stop.captures.length > 1).length;
  const progress = reviewProgress(data.captures);
  const flakyRules = data.captures.filter((capture) => capture.rule?.state === "flaky").length;
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
              {progress.total > 0 ? (
                <span className="font-medium text-(--ink-2)">
                  {" "}
                  · {progress.reviewed} of {progress.total} reviewed
                  {progress.reviewed === progress.total ? " · Review complete" : ""}
                </span>
              ) : null}
              {flakyRules > 0 ? (
                <span className="ml-2 font-medium text-(--warn)">
                  · {flakyRules} flaky {flakyRules === 1 ? "story needs" : "stories need"} fixing
                </span>
              ) : null}
            </div>
          </Card>
          {stops.length > 0 ? (
            <>
              <ReviewFilmstrip
                stops={stops}
                selectedId={selected?.id ?? null}
                onSelect={(captureId) => setParam("story", captureId)}
              />
              <Card className="flex flex-col gap-2 px-4 py-3 text-xs sm:flex-row sm:items-center sm:justify-between">
                <span className="inline-flex items-center gap-2 font-medium text-(--ink-2)">
                  <Keyboard size={15} className="text-(--accent)" /> Keyboard shortcuts
                </span>
                <div
                  aria-label="Review keyboard shortcuts"
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-(--muted)"
                >
                  {canReview ? (
                    <>
                      <span>
                        <Kbd>a</Kbd> approve &amp; next
                      </span>
                      <span>
                        <Kbd>x</Kbd> reject &amp; next
                      </span>
                      <span>
                        <Kbd>u</Kbd> return to pending
                      </span>
                    </>
                  ) : null}
                  <span>
                    <Kbd>j</Kbd>/<Kbd>k</Kbd> move
                  </span>
                  <span>
                    <Kbd>d</Kbd> pixel diff
                  </span>
                  <span>
                    <Kbd>b</Kbd> swap images
                  </span>
                </div>
              </Card>
            </>
          ) : null}
          {selected ? (
            <Card className="overflow-hidden">
              <div className="flex flex-col gap-3 border-b border-(--hairline) p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-medium">{selected.name}</h2>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] capitalize ${statusTone[selected.status]}`}
                    >
                      {selected.status}
                    </span>
                    {selected.review ? <ReviewChip review={selected.review} /> : null}
                    {selected.rule &&
                    selected.changeRatio !== undefined &&
                    selected.changeRatio > selected.rule.toleranceRatio ? (
                      <span
                        title={`Current diff exceeds the ${(selected.rule.toleranceRatio * 100).toFixed(3)}% tolerance`}
                        className="shrink-0 rounded-full bg-(--warn)/12 px-2 py-0.5 text-[11px] text-(--warn)"
                      >
                        {selected.rule.state} · outside tolerance
                      </span>
                    ) : null}
                    {selectedStop && selectedStop.captures.length > 1 ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-(--accent-wash) px-2 py-0.5 text-[11px] text-(--accent)">
                        <Layers size={11} /> same change as {selectedStop.captures.length - 1} other
                        {selectedStop.captures.length === 2 ? "" : "s"}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-(--muted)">
                    {selected.title}
                    {selected.changeRatio !== undefined ? (
                      <span> · {(selected.changeRatio * 100).toFixed(3)}% pixels changed</span>
                    ) : null}
                    {selected.rule ? (
                      <span>
                        {" "}
                        · rule allows up to {(selected.rule.toleranceRatio * 100).toFixed(3)}%
                      </span>
                    ) : null}
                    {selected.review && reviewedByLine(selected.review) ? (
                      <span className="text-(--muted)"> · {reviewedByLine(selected.review)}</span>
                    ) : null}
                  </p>
                  {selected.rule?.note ? (
                    <p className="mt-1 text-xs text-(--ink-2)">
                      <span className="font-medium">
                        {selected.rule.state === "flaky" ? "Flaky follow-up:" : "Variance reason:"}
                      </span>{" "}
                      {selected.rule.note}
                    </p>
                  ) : null}
                  {reviewError ? (
                    <p className="mt-1 text-xs text-(--bad)">
                      The review didn't save. Check your connection (or sign-in) and try again.
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1 rounded-lg border border-(--border) bg-(--surface-2) p-1">
                    <button
                      type="button"
                      aria-label="Previous capture"
                      disabled={selectedStopIndex <= 0}
                      onClick={() => {
                        const target = stepStop(stops, selected?.id ?? null, -1);
                        if (target) setParam("story", target.id);
                      }}
                      className="rounded p-1 text-(--muted) hover:bg-(--surface) hover:text-(--ink) disabled:opacity-30"
                    >
                      <ChevronLeft size={15} />
                    </button>
                    <span className="min-w-16 text-center text-[11px] font-medium text-(--muted)">
                      {selectedStopIndex + 1} / {stops.length}
                    </span>
                    <button
                      type="button"
                      aria-label="Next capture"
                      disabled={selectedStopIndex < 0 || selectedStopIndex >= stops.length - 1}
                      onClick={() => {
                        const target = stepStop(stops, selected?.id ?? null, 1);
                        if (target) setParam("story", target.id);
                      }}
                      className="rounded p-1 text-(--muted) hover:bg-(--surface) hover:text-(--ink) disabled:opacity-30"
                    >
                      <ChevronRight size={15} />
                    </button>
                  </div>
                  {canReview && selectedStop ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        disabled={reviewBusy}
                        onClick={() => submitReview("approve")}
                        title={
                          selectedStop.captures.length > 1
                            ? `Approve all ${selectedStop.captures.length} stories with this change (a)`
                            : "Approve this change (a)"
                        }
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium disabled:opacity-50 ${
                          stopReviewState(selectedStop)?.state === "approved"
                            ? "border-(--good)/40 bg-(--good)/12 text-(--good)"
                            : "border-(--border) bg-(--surface) hover:border-(--good)/60 hover:text-(--good)"
                        }`}
                      >
                        <Check size={13} /> Approve &amp; next
                        {selectedStop.captures.length > 1 ? ` ${selectedStop.captures.length}` : ""}
                      </button>
                      <button
                        type="button"
                        onClick={() => startRule("allowed")}
                        disabled={reviewBusy || selected.changeRatio === undefined}
                        aria-pressed={selected.rule?.state === "allowed"}
                        title="Allow this story's known visual variance on future runs"
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium disabled:opacity-50 ${
                          selected.rule?.state === "allowed"
                            ? "border-(--accent)/40 bg-(--accent-wash) text-(--accent)"
                            : "border-(--border) bg-(--surface) hover:border-(--accent)/60 hover:text-(--accent)"
                        }`}
                      >
                        <ShieldCheck size={13} /> Allow variance
                      </button>
                      <button
                        type="button"
                        onClick={() => startRule("flaky")}
                        disabled={reviewBusy || selected.changeRatio === undefined}
                        aria-pressed={selected.rule?.state === "flaky"}
                        title="Mark this story as flaky and keep known-size future diffs non-blocking"
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium disabled:opacity-50 ${
                          selected.rule?.state === "flaky"
                            ? "border-(--warn)/40 bg-(--warn)/12 text-(--warn)"
                            : "border-(--border) bg-(--surface) hover:border-(--warn)/60 hover:text-(--warn)"
                        }`}
                      >
                        <Bug size={13} /> Mark flaky
                      </button>
                      <button
                        type="button"
                        disabled={reviewBusy}
                        onClick={() => submitReview("reject")}
                        title={
                          selectedStop.captures.length > 1
                            ? `Reject all ${selectedStop.captures.length} stories with this change (x)`
                            : "Reject this change (x)"
                        }
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium disabled:opacity-50 ${
                          stopReviewState(selectedStop)?.state === "rejected"
                            ? "border-(--bad)/40 bg-(--bad)/12 text-(--bad)"
                            : "border-(--border) bg-(--surface) hover:border-(--bad)/60 hover:text-(--bad)"
                        }`}
                      >
                        <X size={13} /> Reject &amp; next
                        {selectedStop.captures.length > 1 ? ` ${selectedStop.captures.length}` : ""}
                      </button>
                      {stopReviewState(selectedStop)?.state !== "pending" ? (
                        <button
                          type="button"
                          disabled={reviewBusy}
                          onClick={() => submitReview("unreview")}
                          title="Return to pending (u)"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-(--border) bg-(--surface) px-2.5 py-1.5 text-xs font-medium hover:border-(--muted) disabled:opacity-50"
                        >
                          <RotateCcw size={13} />
                        </button>
                      ) : null}
                    </div>
                  ) : null}
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
              </div>
              {ruleDraft ? (
                <div className="border-b border-(--hairline) bg-(--surface-2) px-4 py-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                    <label className="text-xs font-medium text-(--ink-2)">
                      Pixel tolerance
                      <span className="mt-1 flex items-center rounded-lg border border-(--border) bg-(--surface) px-2.5">
                        <input
                          aria-label="Allowed changed pixels percentage"
                          type="number"
                          min="0.001"
                          max="100"
                          step="0.001"
                          value={ruleDraft.tolerancePercent}
                          onChange={(event) =>
                            setRuleDraft((draft) =>
                              draft ? { ...draft, tolerancePercent: event.target.value } : draft,
                            )
                          }
                          className="w-24 bg-transparent py-2 text-sm outline-none"
                        />
                        <span className="text-xs text-(--muted)">%</span>
                      </span>
                    </label>
                    <label className="min-w-0 flex-1 text-xs font-medium text-(--ink-2)">
                      Reason or follow-up
                      <input
                        aria-label="Visual rule reason"
                        type="text"
                        maxLength={500}
                        value={ruleDraft.note}
                        onChange={(event) =>
                          setRuleDraft((draft) =>
                            draft ? { ...draft, note: event.target.value } : draft,
                          )
                        }
                        placeholder={
                          ruleDraft.state === "flaky"
                            ? "What needs fixing? Add an issue reference if one exists."
                            : "Why is this variance expected?"
                        }
                        className="mt-1 block w-full rounded-lg border border-(--border) bg-(--surface) px-3 py-2 text-sm font-normal outline-none focus:border-(--accent)"
                      />
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={reviewBusy}
                        onClick={saveRule}
                        className="rounded-lg bg-(--accent) px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
                      >
                        Save {ruleDraft.state === "flaky" ? "flaky rule" : "variance"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setRuleDraft(null)}
                        className="rounded-lg border border-(--border) bg-(--surface) px-3 py-2 text-xs font-medium"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                  <p
                    className={`mt-2 text-xs ${ruleValidation ? "text-(--bad)" : "text-(--muted)"}`}
                  >
                    {ruleValidation ??
                      `The current diff is ${(selected.changeRatio! * 100).toFixed(3)}%. Larger future changes will return to review.`}
                  </p>
                </div>
              ) : canReview && selected.changeRatio === undefined ? (
                <p className="border-b border-(--hairline) bg-(--surface-2) px-4 py-2 text-xs text-(--muted)">
                  Persistent rules need a measured changed-pixel comparison. They are unavailable
                  for new or removed captures and storage backends without comparison support.
                </p>
              ) : null}
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
          </Card>
          {stops.length === 0 ? (
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
          ) : null}
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
 * A commit is a set of current component images, not a comparison. This view
 * deliberately omits baselines, diff state, and review controls so browsing
 * what shipped cannot be confused with reviewing how it changed.
 */
function ComponentCaptureGallery({
  data,
  query,
  onQueryChange,
}: {
  data: PreviewDetailPayload;
  query: string;
  onQueryChange: (value: string) => void;
}) {
  const needle = query.trim().toLocaleLowerCase();
  const captures = data.captures.filter(
    (capture) =>
      capture.imageUrl &&
      (!needle || `${capture.title} ${capture.name}`.toLocaleLowerCase().includes(needle)),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <Link
            to={`/r/${data.run.repo}/components`}
            className="text-xs text-(--muted) hover:text-(--ink)"
          >
            ← Components
          </Link>
          <h1 className="mt-2 text-xl font-semibold">Components on {data.run.branch}</h1>
          <p className="mt-1 text-xs text-(--muted)">
            <span className="font-mono">{data.run.commit}</span> · {when(data.run.createdAt)} ·{" "}
            {data.captures.filter((capture) => capture.imageUrl).length} component states
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={`/r/${data.run.repo}/storybook-previews/${data.run.id}`}
            className="inline-flex items-center gap-2 rounded-lg border border-(--border) bg-(--surface) px-3 py-2 text-xs font-medium hover:border-(--muted)"
          >
            View visual diff
          </Link>
          {data.run.status === "complete" ? (
            <a
              href={data.previewUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-(--border) bg-(--surface) px-3 py-2 text-xs font-medium hover:border-(--muted)"
            >
              Open interactive Storybook <ExternalLink size={14} />
            </a>
          ) : null}
        </div>
      </div>

      <Card className="p-3 sm:p-4">
        <label className="relative block">
          <Search
            size={15}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-(--muted)"
          />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={`Search ${data.captures.filter((capture) => capture.imageUrl).length} component states`}
            className="w-full rounded-lg border border-(--border) bg-(--surface-2) py-2 pr-3 pl-9 text-sm outline-none focus:border-(--muted)"
          />
        </label>
      </Card>

      {captures.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {captures.map((capture) => (
            <Card key={capture.id} className="overflow-hidden">
              <a
                href={capture.imageUrl}
                target="_blank"
                rel="noreferrer"
                className="block bg-white"
              >
                <img
                  src={capture.imageUrl}
                  alt={`${capture.title} — ${capture.name}`}
                  loading="lazy"
                  className="aspect-video h-auto w-full object-contain"
                />
              </a>
              <div className="border-t border-(--hairline) px-4 py-3">
                <p className="truncate text-sm font-medium">{capture.name}</p>
                <p className="mt-0.5 truncate text-xs text-(--muted)">{capture.title}</p>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="p-6 text-center text-sm text-(--muted)">
          No component states match “{query}”.
        </Card>
      )}
    </div>
  );
}

/**
 * Compact navigator for the review queue. The large comparison above remains
 * the review surface; these thumbnails answer "where am I?" and allow direct jumps.
 */
function ReviewFilmstrip({
  stops,
  selectedId,
  onSelect,
}: {
  stops: ReviewStop[];
  selectedId: string | null;
  onSelect: (captureId: string) => void;
}) {
  const pending = stops.filter((stop) => stopReviewState(stop)?.state === "pending").length;

  return (
    <Card className="overflow-hidden p-3">
      <div className="mb-3 flex flex-col gap-1 px-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium">Images needing review</p>
          <p className="mt-0.5 text-[11px] text-(--muted)">
            Choose any thumbnail. Decisions automatically continue to the next pending image.
          </p>
        </div>
        <p className="text-xs font-medium text-(--ink-2)">
          {pending} pending · {stops.length - pending} decided
        </p>
      </div>
      <div className="flex snap-x gap-2 overflow-x-auto pb-2">
        {stops.map((stop, index) => {
          const representative = stop.captures[0]!;
          const active = stop.captures.some((capture) => capture.id === selectedId);
          const review = stopReviewState(stop);
          return (
            <button
              key={stop.key}
              type="button"
              onClick={() => onSelect(representative.id)}
              ref={(node) => {
                if (active) {
                  node?.scrollIntoView?.({
                    behavior: "smooth",
                    block: "nearest",
                    inline: "center",
                  });
                }
              }}
              aria-current={active ? "step" : undefined}
              aria-label={`${index + 1} of ${stops.length}: ${representative.title} — ${representative.name}, ${review?.state ?? "not reviewable"}`}
              className={`w-40 shrink-0 snap-start overflow-hidden rounded-lg border text-left transition-colors ${
                active
                  ? "border-(--accent) bg-(--accent-wash) ring-1 ring-(--accent)"
                  : "border-(--border) bg-(--surface) hover:border-(--muted)"
              }`}
            >
              <div className="relative h-24 bg-(--surface-2) p-1.5">
                <img
                  src={representative.imageUrl || representative.baselineImageUrl}
                  alt=""
                  loading="lazy"
                  className="h-full w-full rounded bg-white object-contain"
                />
                <span className="absolute top-2 left-2 rounded bg-black/65 px-1.5 py-0.5 text-[10px] font-medium text-white">
                  {index + 1}
                </span>
                {stop.captures.length > 1 ? (
                  <span className="absolute top-2 right-2 inline-flex items-center gap-1 rounded bg-black/65 px-1.5 py-0.5 text-[10px] text-white">
                    <Layers size={10} /> {stop.captures.length}
                  </span>
                ) : null}
              </div>
              <div className="space-y-1 border-t border-(--hairline) p-2">
                <p className="truncate text-xs font-medium">{representative.name}</p>
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate text-[10px] capitalize text-(--muted)">
                    {representative.status}
                  </span>
                  {review ? <ReviewChip review={review} /> : null}
                </div>
              </div>
            </button>
          );
        })}
      </div>
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
          className="mx-auto max-h-[78vh] w-auto max-w-full object-contain"
        />
      </a>
    </figure>
  );
}
