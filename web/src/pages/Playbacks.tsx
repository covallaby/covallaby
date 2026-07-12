import {
  AlertCircle,
  Bug,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CirclePlay,
  Download,
  FileArchive,
  GitCommit,
  GitPullRequest,
  Images,
  Maximize2,
  Monitor,
  Play,
  RotateCw,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { type TestArtifact, type TestRun, api } from "../api.js";
import { Card, CardHeader, Stat, Td, Th } from "../components/ui.js";
import { buildPlaybackLibrary, shortJourneyName } from "../playback.js";
import { useRepo } from "./Repo.js";

const when = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(iso),
  );
const duration = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

export function Playbacks() {
  const { repo } = useRepo();
  const [runs, setRuns] = useState<TestRun[] | null>(null);
  const [error, setError] = useState(false);
  const [request, setRequest] = useState(0);
  useEffect(() => {
    void request;
    setRuns(null);
    setError(false);
    api
      .testRuns(repo)
      .then((r) => setRuns(r.runs))
      .catch(() => setError(true));
  }, [repo, request]);
  return (
    <Card>
      <CardHeader
        title="Playwright runs"
        description="Watch the browser flows CI exercised, with traces and screenshots beside them."
      />
      {error ? (
        <div className="mx-5 mb-5 flex items-start justify-between gap-4 rounded-xl border border-(--bad)/25 bg-(--bad)/5 p-4">
          <div className="flex gap-3">
            <AlertCircle className="mt-0.5 shrink-0 text-(--bad)" size={18} />
            <div>
              <p className="text-sm font-medium">We couldn't load Playwright runs.</p>
              <p className="mt-1 text-xs text-(--muted)">
                Your recordings are still safe. Check the connection and try again.
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
      ) : !runs ? (
        <p className="px-5 pb-5 text-sm text-(--muted)">Loading Playwright runs…</p>
      ) : runs.length === 0 ? (
        <div className="px-5 pb-6 text-sm text-(--muted)">
          <p>
            No Playwright runs yet. Add{" "}
            <code className="rounded bg-(--surface-2) px-1.5 py-0.5">playwright-results</code> to
            the Covallaby Action and the first run will appear here.
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-2 px-3 pb-3 md:hidden">
            {runs.map((run) => (
              <Link
                key={run.id}
                to={`/r/${repo}/test-runs/${run.id}`}
                className="block rounded-xl border border-(--border) bg-(--surface-2)/45 p-3.5 active:bg-(--surface-2)"
              >
                <div className="flex items-start gap-2.5">
                  {run.testsFailed ? (
                    <XCircle className="mt-0.5 shrink-0 text-(--bad)" size={18} />
                  ) : (
                    <CirclePlay className="mt-0.5 shrink-0 text-(--good)" size={18} />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0 truncate text-sm font-medium">
                        {run.pr ? `PR #${run.pr}` : run.branch}
                      </span>
                      <span className="shrink-0 text-[11px] text-(--muted)">
                        {duration(run.durationMs)}
                      </span>
                    </div>
                    <p className="mt-1 truncate font-mono text-[11px] text-(--muted)">
                      {run.commit.slice(0, 10)} · {when(run.createdAt)}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                      <span className="text-(--good)">{run.testsPassed} passed</span>
                      {run.testsFailed ? (
                        <span className="text-(--bad)">{run.testsFailed} failed</span>
                      ) : null}
                      {run.testsSkipped ? (
                        <span className="text-(--muted)">{run.testsSkipped} skipped</span>
                      ) : null}
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[760px] text-[13.5px]">
              <thead>
                <tr>
                  <Th>Run</Th>
                  <Th>Commit</Th>
                  <Th>When</Th>
                  <Th right>Tests</Th>
                  <Th right>Duration</Th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id} className="hover:bg-(--surface-2)">
                    <Td>
                      <Link
                        className="font-medium hover:underline"
                        to={`/r/${repo}/test-runs/${run.id}`}
                      >
                        {run.testsFailed ? (
                          <XCircle className="mr-2 inline text-(--bad)" size={16} />
                        ) : (
                          <CirclePlay className="mr-2 inline text-(--good)" size={16} />
                        )}
                        {run.pr ? `PR #${run.pr} Playwright run` : `${run.branch} Playwright run`}
                      </Link>
                    </Td>
                    <Td>
                      <span className="font-mono text-xs">{run.commit.slice(0, 10)}</span>
                      <a
                        className="ml-2 inline-flex text-(--muted) hover:text-(--ink)"
                        href={`https://github.com/${repo}/commit/${run.commit}`}
                        target="_blank"
                        rel="noreferrer"
                        aria-label="Open commit on GitHub"
                      >
                        <GitCommit size={14} />
                      </a>
                      {run.pr ? (
                        <a
                          className="ml-2 inline-flex items-center gap-1 text-(--muted) hover:text-(--ink)"
                          href={`https://github.com/${repo}/pull/${run.pr}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <GitPullRequest size={14} />#{run.pr}
                        </a>
                      ) : null}
                    </Td>
                    <Td className="text-(--muted)">{when(run.createdAt)}</Td>
                    <Td className="text-right">
                      <span className="text-(--good)">{run.testsPassed} passed</span>
                      {run.testsFailed ? (
                        <span className="ml-2 text-(--bad)">{run.testsFailed} failed</span>
                      ) : null}
                    </Td>
                    <Td className="text-right tabular-nums text-(--muted)">
                      {duration(run.durationMs)}
                    </Td>
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

type ViewerTab = "steps" | "video" | "trace" | "files";

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
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-(--border) bg-(--surface-2) px-2.5 py-1 font-mono text-[10px] text-(--muted)">
      <Monitor size={11} /> {width && height ? `${width} × ${height}` : "detecting viewport"}
    </span>
  );
}

export function JourneyViewer({ artifacts }: { artifacts: TestArtifact[] }) {
  const library = useMemo(() => buildPlaybackLibrary(artifacts), [artifacts]);
  const [journeyIndex, setJourneyIndex] = useState(0);
  const [stepIndex, setStepIndex] = useState(0);
  const [tab, setTab] = useState<ViewerTab>("steps");
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const journey = library.journeys[journeyIndex] ?? null;
  const selectedStep = journey?.screenshots[stepIndex] ?? null;
  const video = journey?.videos.toSorted((a, b) => b.sizeBytes - a.sizeBytes)[0] ?? null;

  useEffect(() => {
    setStepIndex(0);
    setDimensions(null);
    const next = library.journeys[journeyIndex];
    setTab(next?.screenshots.length ? "steps" : next?.videos.length ? "video" : "trace");
  }, [journeyIndex, library.journeys]);

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
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">
                    Step {stepIndex + 1} of {journey.screenshots.length}
                  </p>
                  <p className="mt-0.5 max-w-[50vw] truncate text-xs text-(--muted)">
                    {selectedStep.name}
                  </p>
                </div>
                <ViewportBadge
                  width={dimensions?.width ?? null}
                  height={dimensions?.height ?? null}
                />
              </div>
              <div className="flex min-h-[420px] items-center justify-center overflow-auto rounded-xl border border-(--border) bg-black/90 p-3">
                <img
                  key={selectedStep.id}
                  ref={(element) => {
                    if (element?.complete && element.naturalWidth && !dimensions)
                      setDimensions({
                        width: element.naturalWidth,
                        height: element.naturalHeight,
                      });
                  }}
                  src={selectedStep.url}
                  alt={`${shortJourneyName(journey.name)}, step ${stepIndex + 1}`}
                  onLoad={(event) =>
                    setDimensions({
                      width: event.currentTarget.naturalWidth,
                      height: event.currentTarget.naturalHeight,
                    })
                  }
                  className="max-h-[68vh] max-w-full object-contain shadow-2xl"
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
  const [data, setData] = useState<{ run: TestRun; artifacts: TestArtifact[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .testRun(id!)
      .then(setData)
      .catch((e) => setError(String(e)));
  }, [id]);
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
          {data.run.commit} · {when(data.run.createdAt)}
        </p>
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
