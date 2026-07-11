import {
  AlertCircle,
  Camera,
  CheckCircle2,
  CirclePlay,
  FileArchive,
  FlaskConical,
  GitCommit,
  GitPullRequest,
  RotateCw,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { type TestArtifact, type TestRun, api } from "../api.js";
import { Card, CardHeader, Stat, Td, Th } from "../components/ui.js";
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
        title="Browser runs"
        description="Watch the browser flows CI exercised, with traces and screenshots beside them."
      />
      {error ? (
        <div className="mx-5 mb-5 flex items-start justify-between gap-4 rounded-xl border border-(--bad)/25 bg-(--bad)/5 p-4">
          <div className="flex gap-3">
            <AlertCircle className="mt-0.5 shrink-0 text-(--bad)" size={18} />
            <div>
              <p className="text-sm font-medium">We couldn't load browser runs.</p>
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
        <p className="px-5 pb-5 text-sm text-(--muted)">Loading browser runs…</p>
      ) : runs.length === 0 ? (
        <div className="px-5 pb-6 text-sm text-(--muted)">
          <p>
            No browser runs yet. Add{" "}
            <code className="rounded bg-(--surface-2) px-1.5 py-0.5">playwright-results</code> to
            the Covallaby Action and the first run will appear here.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
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
                      {run.pr ? `PR #${run.pr} browser run` : `${run.branch} browser run`}
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
      )}
    </Card>
  );
}

function ArtifactCard({ artifact }: { artifact: TestArtifact }) {
  if (artifact.kind === "video")
    return (
      <Card>
        <CardHeader title={artifact.testName || artifact.name} description="Browser recording" />
        {/* biome-ignore lint/a11y/useMediaCaption: Playwright recordings do not include caption tracks. */}
        <video
          className="aspect-video w-full bg-black"
          controls
          preload="metadata"
          src={artifact.url}
        />
      </Card>
    );
  if (artifact.kind === "screenshot")
    return (
      <Card>
        <CardHeader title={artifact.testName || artifact.name} description="Captured milestone" />
        <a href={artifact.url} target="_blank" rel="noreferrer">
          <img
            className="w-full border-t border-(--hairline)"
            src={artifact.url}
            alt={artifact.testName || artifact.name}
          />
        </a>
      </Card>
    );
  const Icon =
    artifact.kind === "trace" ? FlaskConical : artifact.kind === "report" ? Camera : FileArchive;
  return (
    <a
      href={artifact.url}
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
        <p className="text-sm font-medium text-(--bad)">This browser run couldn't be loaded.</p>
        <p className="mt-1 text-xs text-(--muted)">
          The run may have expired under your retention policy, or the connection may be
          unavailable.
        </p>
      </div>
    );
  if (!data) return <p className="text-sm text-(--muted)">Loading playback…</p>;
  const videos = data.artifacts.filter((a) => a.kind === "video");
  const screenshots = data.artifacts.filter((a) => a.kind === "screenshot");
  const downloads = data.artifacts.filter((a) => a.kind !== "video" && a.kind !== "screenshot");
  return (
    <div className="space-y-5">
      <div>
        <Link
          to={`/r/${data.run.repo}/playbacks`}
          className="text-xs text-(--muted) hover:text-(--ink)"
        >
          ← All playbacks
        </Link>
        <h1 className="mt-2 text-xl font-semibold">
          {data.run.pr ? `PR #${data.run.pr}` : data.run.branch} browser run
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
      {videos.length > 0 && (
        <section>
          <h2 className="mb-3 text-xs font-semibold tracking-wide text-(--muted) uppercase">
            Recordings
          </h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {videos.map((a) => (
              <ArtifactCard key={a.id} artifact={a} />
            ))}
          </div>
        </section>
      )}
      {screenshots.length > 0 && (
        <section>
          <h2 className="mb-3 text-xs font-semibold tracking-wide text-(--muted) uppercase">
            Milestones
          </h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {screenshots.map((a) => (
              <ArtifactCard key={a.id} artifact={a} />
            ))}
          </div>
        </section>
      )}
      {downloads.length > 0 && (
        <section>
          <h2 className="mb-3 text-xs font-semibold tracking-wide text-(--muted) uppercase">
            Debug & reports
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {downloads.map((a) => (
              <ArtifactCard key={a.id} artifact={a} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
