import {
  Bug,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  FileArchive,
  Images,
  Maximize2,
  Monitor,
  Play,
  Scan,
  StretchHorizontal,
  XCircle,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { type Neighbors, type TestArtifact, type TestRun, api } from "../api.js";
import { CommitStrip, useCommitSiblings } from "../components/commit-strip.js";
import { LateralNav } from "../components/lateral-nav.js";
import { Card, CardHeader, Stat } from "../components/ui.js";
import { buildPlaybackLibrary, shortJourneyName } from "../playback.js";

const when = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(iso),
  );
const duration = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

type ViewerTab = "steps" | "video" | "trace" | "files";
type ImageMode = "screen" | "width" | "zoom";

function FileLink({ artifact }: { artifact: TestArtifact }) {
  const Icon = artifact.kind === "report" ? Camera : FileArchive;
  return (
    <a
      href={artifact.url}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-3 rounded-xl border border-(--border) bg-(--surface) p-4 hover:border-(--muted)"
    >
      <Icon size={20} className="text-(--accent)" />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">
          {artifact.testName || artifact.name}
        </span>
        <span className="text-xs text-(--muted)">
          {artifact.kind} · {(artifact.sizeBytes / 1024 / 1024).toFixed(1)} MB
        </span>
      </span>
    </a>
  );
}

function ViewportBadge({ width, height }: { width: number | null; height: number | null }) {
  if (!width || !height) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-(--border) bg-(--surface-2) px-2.5 py-1 font-mono text-[10px] text-(--muted)">
      <Monitor size={11} /> {width} × {height}
    </span>
  );
}

export function JourneyViewer({ artifacts }: { artifacts: TestArtifact[] }) {
  const library = useMemo(() => buildPlaybackLibrary(artifacts), [artifacts]);
  const [journeyIndex, setJourneyIndex] = useState(0);
  const [stepIndex, setStepIndex] = useState(0);
  const [tab, setTab] = useState<ViewerTab>("steps");
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [imageMode, setImageMode] = useState<ImageMode>("screen");
  const [zoom, setZoom] = useState(1);
  const stage = useRef<HTMLDivElement>(null);
  const imageScroller = useRef<HTMLDivElement>(null);
  const journey = library.journeys[journeyIndex] ?? null;
  const selectedStep = journey?.screenshots[stepIndex] ?? null;
  const video = journey?.videos.toSorted((a, b) => b.sizeBytes - a.sizeBytes)[0] ?? null;

  useEffect(() => {
    setStepIndex(0);
    setDimensions(null);
    const next = library.journeys[journeyIndex];
    setTab(next?.screenshots.length ? "steps" : next?.videos.length ? "video" : "trace");
  }, [journeyIndex, library.journeys]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset the image canvas when selection changes
  useEffect(() => {
    imageScroller.current?.scrollTo({ top: 0, left: 0 });
    setDimensions(null);
    setZoom(1);
    setImageMode("screen");
  }, [selectedStep?.id]);

  useEffect(() => {
    if (tab !== "steps" || !journey?.screenshots.length) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") setStepIndex((value) => Math.max(0, value - 1));
      if (event.key === "ArrowRight")
        setStepIndex((value) => Math.min(journey.screenshots.length - 1, value + 1));
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [journey, tab]);

  if (!journey)
    return (
      <Card className="p-5">
        <p className="text-sm font-medium">This run has no journey-linked artifacts.</p>
        <p className="mt-1 text-xs text-(--muted)">
          The run-level files are still available below, but this upload predates journey metadata.
        </p>
      </Card>
    );

  const tabs: Array<{ id: ViewerTab; label: string; count: number; icon: typeof Images }> = [
    { id: "steps", label: "Steps", count: journey.screenshots.length, icon: Images },
    { id: "video", label: "Video", count: journey.videos.length ? 1 : 0, icon: Play },
    { id: "trace", label: "Trace", count: journey.traces.length, icon: Bug },
    { id: "files", label: "Files", count: journey.files.length, icon: FileArchive },
  ];

  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
      <Card className="min-w-0 overflow-hidden">
        <div className="border-b border-(--hairline) px-4 py-3">
          <p className="text-xs font-semibold tracking-wide text-(--muted) uppercase">Journeys</p>
          <p className="mt-1 text-xs text-(--muted)">{library.journeys.length} recorded flows</p>
        </div>
        <div className="flex gap-1 overflow-x-auto p-2 xl:max-h-[660px] xl:flex-col xl:overflow-y-auto">
          {library.journeys.map((item, index) => (
            <button
              key={item.name}
              type="button"
              onClick={() => setJourneyIndex(index)}
              className={`w-64 shrink-0 rounded-lg px-3 py-2.5 text-left transition-colors xl:w-full ${
                index === journeyIndex ? "bg-(--accent-wash)" : "hover:bg-(--surface-2)"
              }`}
            >
              <span className="block text-sm font-medium text-(--ink)">
                {shortJourneyName(item.name)}
              </span>
              <span className="mt-1 flex gap-2 text-[10px] text-(--muted)">
                {item.screenshots.length ? <span>{item.screenshots.length} steps</span> : null}
                {item.videos.length ? <span>video</span> : null}
                {item.traces.length ? <span>trace</span> : null}
              </span>
            </button>
          ))}
        </div>
      </Card>

      <Card className="min-w-0 overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-(--hairline) px-4 py-4 sm:px-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold">{shortJourneyName(journey.name)}</h2>
              <p className="mt-1 truncate text-xs text-(--muted)">{journey.name}</p>
            </div>
            <button
              type="button"
              onClick={() => void stage.current?.requestFullscreen()}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-(--border) px-2.5 py-1.5 text-xs hover:border-(--muted)"
            >
              <Maximize2 size={13} /> <span className="hidden sm:inline">Full screen</span>
            </button>
          </div>
          <div className="flex max-w-full gap-1 overflow-x-auto">
            {tabs.map(({ id, label, count, icon: Icon }) => (
              <button
                key={id}
                type="button"
                disabled={count === 0}
                onClick={() => {
                  setTab(id);
                  setDimensions(null);
                }}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs ${
                  tab === id
                    ? "bg-(--accent-wash) font-medium text-(--ink)"
                    : "text-(--muted) hover:bg-(--surface-2) disabled:cursor-not-allowed disabled:opacity-35"
                }`}
              >
                <Icon size={13} /> {label} {count > 1 ? count : ""}
              </button>
            ))}
          </div>
        </div>

        <div ref={stage} className="min-w-0 bg-(--bg) p-3 sm:p-5">
          {tab === "steps" && selectedStep ? (
            <div>
              <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-sm font-medium">
                    Step {stepIndex + 1} of {journey.screenshots.length}
                  </p>
                  <p className="mt-0.5 max-w-[50vw] truncate text-xs text-(--muted)">
                    {selectedStep.name}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <ViewportBadge
                    width={dimensions?.width ?? null}
                    height={dimensions?.height ?? null}
                  />
                  {dimensions && dimensions.height / dimensions.width > 2 ? (
                    <span className="rounded-full bg-(--accent-wash) px-2.5 py-1 text-[10px] font-medium text-(--ink-2)">
                      Full page
                    </span>
                  ) : null}
                  <div className="ml-1 inline-flex rounded-lg border border-(--border) bg-(--surface)">
                    <button
                      type="button"
                      onClick={() => setImageMode("width")}
                      className={`inline-flex items-center gap-1.5 rounded-l-lg px-2.5 py-1.5 text-[11px] ${imageMode === "width" ? "bg-(--accent-wash) text-(--ink)" : "text-(--muted)"}`}
                      title="Fit the image to the available width"
                    >
                      <StretchHorizontal size={12} /> Fit width
                    </button>
                    <button
                      type="button"
                      onClick={() => setImageMode("screen")}
                      className={`inline-flex items-center gap-1.5 border-l border-(--border) px-2.5 py-1.5 text-[11px] ${imageMode === "screen" ? "bg-(--accent-wash) text-(--ink)" : "text-(--muted)"}`}
                      title="Show the entire image"
                    >
                      <Scan size={12} /> Fit screen
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setImageMode("zoom");
                        setZoom((value) => Math.max(0.25, value - 0.25));
                      }}
                      className="border-l border-(--border) px-2 py-1.5 text-(--muted)"
                      aria-label="Zoom out"
                    >
                      <ZoomOut size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setImageMode("zoom");
                        setZoom((value) => Math.min(2, value + 0.25));
                      }}
                      className="rounded-r-lg border-l border-(--border) px-2 py-1.5 text-(--muted)"
                      aria-label="Zoom in"
                    >
                      <ZoomIn size={12} />
                    </button>
                  </div>
                  {imageMode === "zoom" ? (
                    <span className="w-10 text-right font-mono text-[10px] text-(--muted)">
                      {Math.round(zoom * 100)}%
                    </span>
                  ) : null}
                </div>
              </div>
              <div
                ref={imageScroller}
                className={`flex h-[min(70vh,760px)] min-h-[460px] overflow-auto rounded-xl border border-(--border) bg-[linear-gradient(45deg,var(--surface-2)_25%,transparent_25%),linear-gradient(-45deg,var(--surface-2)_25%,transparent_25%),linear-gradient(45deg,transparent_75%,var(--surface-2)_75%),linear-gradient(-45deg,transparent_75%,var(--surface-2)_75%)] bg-[length:20px_20px] bg-[position:0_0,0_10px,10px_-10px,-10px_0px] p-3 ${imageMode === "screen" ? "items-center justify-center" : "items-start justify-center"}`}
              >
                <img
                  key={selectedStep.id}
                  ref={(element) => {
                    if (element?.complete && element.naturalWidth && !dimensions) {
                      const next = {
                        width: element.naturalWidth,
                        height: element.naturalHeight,
                      };
                      setDimensions({
                        ...next,
                      });
                      setImageMode(next.height / next.width > 2 ? "width" : "screen");
                    }
                  }}
                  src={selectedStep.url}
                  alt={`${shortJourneyName(journey.name)}, step ${stepIndex + 1}`}
                  onLoad={(event) => {
                    const next = {
                      width: event.currentTarget.naturalWidth,
                      height: event.currentTarget.naturalHeight,
                    };
                    setDimensions(next);
                    setImageMode(next.height / next.width > 2 ? "width" : "screen");
                  }}
                  style={
                    imageMode === "zoom" && dimensions
                      ? { width: dimensions.width * zoom, maxWidth: "none" }
                      : undefined
                  }
                  className={
                    imageMode === "screen"
                      ? "max-h-full max-w-full object-contain shadow-xl"
                      : imageMode === "width"
                        ? "h-auto w-full max-w-none shadow-xl"
                        : "h-auto max-w-none shadow-xl"
                  }
                />
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  disabled={stepIndex === 0}
                  onClick={() => setStepIndex((value) => value - 1)}
                  className="rounded-lg border border-(--border) p-2 disabled:opacity-30"
                  aria-label="Previous step"
                >
                  <ChevronLeft size={16} />
                </button>
                <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto py-1">
                  {journey.screenshots.map((screenshot, index) => (
                    <button
                      key={screenshot.id}
                      type="button"
                      onClick={() => {
                        setStepIndex(index);
                        setDimensions(null);
                      }}
                      className={`h-14 w-24 shrink-0 overflow-hidden rounded-md border-2 bg-black ${
                        index === stepIndex ? "border-(--accent)" : "border-transparent opacity-65"
                      }`}
                      aria-label={`Open step ${index + 1}`}
                    >
                      <img src={screenshot.url} alt="" className="h-full w-full object-contain" />
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  disabled={stepIndex === journey.screenshots.length - 1}
                  onClick={() => setStepIndex((value) => value + 1)}
                  className="rounded-lg border border-(--border) p-2 disabled:opacity-30"
                  aria-label="Next step"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          ) : null}

          {tab === "video" && video ? (
            <div>
              <div className="mb-3 flex justify-end">
                <ViewportBadge
                  width={dimensions?.width ?? null}
                  height={dimensions?.height ?? null}
                />
              </div>
              <div className="flex min-h-[420px] items-center justify-center overflow-hidden rounded-xl border border-(--border) bg-black">
                {/* biome-ignore lint/a11y/useMediaCaption: Playwright recordings do not include caption tracks. */}
                <video
                  controls
                  preload="metadata"
                  src={video.url}
                  onLoadedMetadata={(event) =>
                    setDimensions({
                      width: event.currentTarget.videoWidth,
                      height: event.currentTarget.videoHeight,
                    })
                  }
                  className="max-h-[72vh] max-w-full object-contain"
                />
              </div>
            </div>
          ) : null}

          {tab === "trace" ? (
            <div className="mx-auto max-w-xl py-14 text-center">
              <Bug className="mx-auto text-(--accent)" size={30} />
              <h3 className="mt-4 text-base font-semibold">Inspect the Playwright trace</h3>
              <p className="mt-2 text-sm leading-6 text-(--muted)">
                Time-travel through every action with DOM snapshots, network activity, console logs,
                source locations, and precise timing.
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {journey.traces.map((trace) => (
                  <a
                    key={trace.id}
                    href={trace.viewerUrl ?? trace.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 rounded-lg bg-(--accent) px-4 py-2 text-sm font-medium text-white"
                  >
                    <Bug size={15} /> Open interactive trace
                  </a>
                ))}
                {journey.traces.map((trace) => (
                  <a
                    key={`download-${trace.id}`}
                    href={trace.url}
                    className="inline-flex items-center gap-2 rounded-lg border border-(--border) px-4 py-2 text-sm font-medium"
                  >
                    <Download size={15} /> Download
                  </a>
                ))}
              </div>
            </div>
          ) : null}

          {tab === "files" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {journey.files.map((artifact) => (
                <FileLink key={artifact.id} artifact={artifact} />
              ))}
            </div>
          ) : null}
        </div>
      </Card>

      {library.runFiles.length > 0 ? (
        <Card className="min-w-0 p-4 xl:col-start-2">
          <h2 className="text-xs font-semibold tracking-wide text-(--muted) uppercase">
            Run files
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {library.runFiles.map((artifact) => (
              <FileLink key={artifact.id} artifact={artifact} />
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

export function PlaybackDetail() {
  const { id } = useParams();
  const [data, setData] = useState<{
    run: TestRun;
    neighbors?: Neighbors<TestRun>;
    artifacts: TestArtifact[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .testRun(id!)
      .then(setData)
      .catch((e) => setError(String(e)));
  }, [id]);
  const siblings = useCommitSiblings(data?.run.repo, data?.run.commit);
  if (error)
    return (
      <div className="rounded-xl border border-(--bad)/25 bg-(--bad)/5 p-5">
        <p className="text-sm font-medium text-(--bad)">This Playwright run couldn't be loaded.</p>
        <p className="mt-1 text-xs text-(--muted)">
          The run may have expired under your retention policy, or the connection may be
          unavailable.
        </p>
      </div>
    );
  if (!data) return <p className="text-sm text-(--muted)">Loading playback…</p>;
  return (
    <div className="space-y-5">
      <div>
        <Link
          to={`/r/${data.run.repo}/playbacks`}
          className="text-xs text-(--muted) hover:text-(--ink)"
        >
          ← All Playwright runs
        </Link>
        <h1 className="mt-2 text-xl font-semibold">
          {data.run.pr ? `PR #${data.run.pr}` : data.run.branch} Playwright run
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
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <CommitStrip
            repo={data.run.repo}
            commit={data.run.commit}
            pr={data.run.pr}
            current="journeys"
            siblings={siblings}
          />
        </div>
        <LateralNav
          noun="run"
          prev={
            data.neighbors?.prev
              ? {
                  to: `/r/${data.run.repo}/test-runs/${data.neighbors.prev.id}`,
                  title: `${data.neighbors.prev.commit.slice(0, 10)} on ${data.neighbors.prev.branch}`,
                }
              : null
          }
          next={
            data.neighbors?.next
              ? {
                  to: `/r/${data.run.repo}/test-runs/${data.neighbors.next.id}`,
                  title: `${data.neighbors.next.commit.slice(0, 10)} on ${data.neighbors.next.branch}`,
                }
              : null
          }
        />
      </div>
      <Card className="p-5">
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-5">
          <Stat
            value={<span className="text-(--good)">{data.run.testsPassed}</span>}
            label="Passed"
          />
          <Stat
            value={
              <span className={data.run.testsFailed ? "text-(--bad)" : ""}>
                {data.run.testsFailed}
              </span>
            }
            label="Failed"
          />
          <Stat value={data.run.testsSkipped} label="Skipped" />
          <Stat value={duration(data.run.durationMs)} label="Duration" />
          <Stat
            value={
              data.run.status === "complete" ? (
                <CheckCircle2 className="text-(--good)" />
              ) : (
                <XCircle className="text-(--bad)" />
              )
            }
            label={data.run.status}
          />
        </div>
      </Card>
      <JourneyViewer artifacts={data.artifacts} />
    </div>
  );
}
