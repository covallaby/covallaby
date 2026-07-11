import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { type ArtifactStorage, artifactObjectKey } from "./artifacts.js";
import { type AppEnv, type HostedConfig, type HostedDeps, mountHosted } from "./hosted/index.js";
import {
  type PolicyInput,
  type PolicyViolation,
  type RepoPolicy,
  evaluatePolicy,
  parsePolicy,
  renderStatusBadge,
} from "./policy.js";
import { type ArtifactRetentionConfig, cleanupRepoArtifacts } from "./retention.js";
import type { Store, UploadRow } from "./store.js";
import type { TestArtifactKind } from "./store.js";
import { renderBadge } from "./vendor/badge.js";
import { ignorePaths } from "./vendor/ignore.js";
import {
  type CoverageReport,
  formatRanges,
  mergeReports,
  rollupByDirectory,
  summarize,
  uncoveredRanges,
} from "./vendor/model.js";
import { ParseError, parseCoverage } from "./vendor/parsers/index.js";

export interface AppOptions {
  store: Store;
  uploadToken: string;
  /** Optional read gate; unset = dashboard is public. */
  viewToken?: string;
  /** Upload rate limit per token (sliding minute). Default 30. */
  uploadsPerMinute?: number;
  /** Present → mount the hosted tier (OAuth, billing, per-account scoping). */
  hosted?: HostedConfig;
  hostedDeps?: HostedDeps;
  /** Binary storage for Playwright videos, traces, screenshots, and reports. */
  artifactStorage?: ArtifactStorage;
  artifactRetention?: ArtifactRetentionConfig;
  /** Separate origin used to execute untrusted Storybook builds safely. */
  storybookPreviewBaseUrl?: string;
  storybookPreviewSecret?: string;
}

const REPO_RE = /^[\w.-]+\/[\w.-]+$/;
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 500 * 1024 * 1024;
const MAX_RUN_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_STORYBOOK_FILES = 2_000;
const MAX_STORYBOOK_FILE_BYTES = 100 * 1024 * 1024;
const MAX_STORYBOOK_BYTES = 1024 * 1024 * 1024;
const ARTIFACT_KINDS = new Set<TestArtifactKind>([
  "video",
  "screenshot",
  "trace",
  "report",
  "results",
  "other",
]);

function tokenEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export async function ensureUploadToken(store: Store, fromEnv?: string): Promise<string> {
  if (fromEnv?.trim()) return fromEnv.trim();
  const existing = await store.getMeta("upload-token");
  if (existing) return existing;
  const generated = randomBytes(24).toString("base64url");
  await store.setMeta("upload-token", generated);
  return generated;
}

export interface ReportChanges {
  added: Array<{ path: string; percent: number | null; total: number }>;
  removed: number;
  changed: Array<{ path: string; before: number | null; after: number | null; delta: number }>;
}

/** Per-file diff between two normalized reports (project-level, not patch). */
export function diffReports(head: CoverageReport, base: CoverageReport): ReportChanges {
  const before = new Map(summarize(base).files.map((f) => [f.path, f.lines]));
  const added: ReportChanges["added"] = [];
  const changed: ReportChanges["changed"] = [];
  for (const f of summarize(head).files) {
    const b = before.get(f.path);
    if (!b) {
      added.push({ path: f.path, percent: f.lines.percent, total: f.lines.total });
    } else if (
      f.lines.percent !== null &&
      b.percent !== null &&
      Math.abs(f.lines.percent - b.percent) >= 0.05
    ) {
      changed.push({
        path: f.path,
        before: b.percent,
        after: f.lines.percent,
        delta: f.lines.percent - b.percent,
      });
    }
    before.delete(f.path);
  }
  changed.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  added.sort((a, b) => (a.percent ?? 101) - (b.percent ?? 101));
  return { added, removed: before.size, changed: changed.slice(0, 100) };
}

/**
 * Per-executable-line coverage as a compact string, one char per line in file
 * order: "2" covered, "1" covered-but-a-branch-was-missed, "0" never hit.
 * Powers the file "barcode" without ever shipping source — just the shape.
 */
function coverageBitmap(file: CoverageReport["files"][number]): string {
  const partial = new Set<number>();
  for (const b of file.branches) {
    if (b.total > 0 && b.taken > 0 && b.taken < b.total) partial.add(b.line);
  }
  let out = "";
  for (const l of file.lines) out += l.hits === 0 ? "0" : partial.has(l.line) ? "1" : "2";
  return out;
}

/** Prefer the conventional default branch, else whatever the store lists first. */
function defaultBranch(branches: string[], fallback: string): string {
  return branches.find((b) => b === "main" || b === "master") ?? branches[0] ?? fallback;
}

/** Where a repo's policy lives in the meta KV — one JSON blob per repo. */
const policyKey = (repo: string): string => `policy:${repo}`;

async function loadPolicy(store: Store, repo: string): Promise<RepoPolicy | null> {
  const raw = await store.getMeta(policyKey(repo));
  if (!raw) return null;
  try {
    return parsePolicy(JSON.parse(raw));
  } catch {
    return null; // a corrupt blob shouldn't 500 the gate — treat as "no policy"
  }
}

export interface Comparison {
  head: UploadRow;
  base: UploadRow;
  same: boolean;
  changes: ReportChanges | null;
}

/**
 * Resolve the head/base pair a compare or status check runs on. Head is the
 * latest upload of `?pr=N` or `?head=<branch>`; base is the latest on
 * `?base=<branch>` (default main). Returns a friendly error + HTTP status when
 * either side can't be found, so callers just forward it.
 */
async function resolveComparison(
  store: Store,
  repo: string,
  q: { base?: string | undefined; pr?: string | undefined; head?: string | undefined },
): Promise<Comparison | { error: string; status: 404 }> {
  const baseBranch = q.base ?? "main";

  let headRow: UploadRow | null = null;
  if (q.pr && /^\d+$/.test(q.pr)) {
    const prs = await store.listPRs(repo, 100);
    headRow = prs.find((p) => p.pr === Number(q.pr))?.latest ?? null;
  } else if (q.head) {
    headRow = await store.latest(repo, q.head);
  }
  if (!headRow) return { error: "No uploads found for that head.", status: 404 };

  const baseRow = await store.latest(repo, baseBranch);
  if (!baseRow) {
    return { error: `No uploads found on base branch "${baseBranch}".`, status: 404 };
  }
  if (baseRow.id === headRow.id) {
    return { head: headRow, base: baseRow, same: true, changes: null };
  }
  const head = await store.getUpload(headRow.id);
  const base = await store.getUpload(baseRow.id);
  if (!head || !base) return { error: "Upload vanished.", status: 404 };
  return {
    head: headRow,
    base: baseRow,
    same: false,
    changes: diffReports(head.report, base.report),
  };
}

/** The policy verdict for a comparison, plus the inputs it was judged on. */
function judge(
  policy: RepoPolicy | null,
  cmp: Comparison,
): {
  input: PolicyInput;
  result: ReturnType<typeof evaluatePolicy>;
} {
  const input: PolicyInput = {
    projectPercent: cmp.head.percent,
    basePercent: cmp.base.percent,
    addedFiles: (cmp.changes?.added ?? []).map((f) => ({ path: f.path, percent: f.percent })),
  };
  return { input, result: evaluatePolicy(policy, input) };
}

export interface StatusResult {
  repo: string;
  /** True when a policy is set — otherwise the gate is open. */
  configured: boolean;
  passed: boolean;
  violations: PolicyViolation[];
  head: UploadRow | null;
  base: UploadRow | null;
  /** How head/base were chosen: an explicit compare, the prior upload, or none. */
  basis: "compare" | "previous" | "none";
  note?: string;
}

/**
 * Evaluate a repo's policy for the status endpoint and badge. With `pr`/`head`
 * it judges that comparison; otherwise it judges the latest default-branch
 * upload against the one before it. Never throws: a missing comparison leaves
 * the gate open when no policy is set, and fails closed when one is.
 */
async function computeStatus(
  store: Store,
  repo: string,
  q: { base?: string | undefined; pr?: string | undefined; head?: string | undefined },
): Promise<StatusResult> {
  const policy = await loadPolicy(store, repo);
  const wantsCompare = Boolean(q.pr || q.head);

  let cmp: Comparison | null = null;
  let error: string | undefined;

  if (wantsCompare) {
    const resolved = await resolveComparison(store, repo, q);
    if ("error" in resolved) error = resolved.error;
    else cmp = resolved;
  } else {
    const branches = await store.branches(repo);
    const branch = branches.find((b) => b === "main" || b === "master") ?? branches[0];
    const headRow = branch ? await store.latest(repo, branch) : null;
    if (!headRow) {
      error = "No uploads found for this repository.";
    } else {
      const prev = await store.prevUpload(repo, headRow.branch, headRow.id);
      const head = await store.getUpload(headRow.id);
      cmp =
        prev && head
          ? {
              head: headRow,
              base: prev.row,
              same: false,
              changes: diffReports(head.report, prev.report),
            }
          : // A repo's very first upload: judge the project floor with no base.
            { head: headRow, base: headRow, same: true, changes: null };
    }
  }

  if (!cmp) {
    return {
      repo,
      configured: Boolean(policy),
      passed: !policy, // no policy → open gate; a set policy fails closed
      violations: policy
        ? [
            {
              kind: "project",
              actual: null,
              required: 0,
              message: error ?? "No coverage data to evaluate the policy against.",
            },
          ]
        : [],
      head: null,
      base: null,
      basis: "none",
      ...(error && { note: error }),
    };
  }

  const { result } = judge(policy, cmp);
  return {
    repo,
    configured: result.configured,
    passed: result.passed,
    violations: result.violations,
    head: cmp.head,
    base: cmp.same ? null : cmp.base,
    basis: wantsCompare ? "compare" : "previous",
  };
}

export function createApp({
  store,
  uploadToken,
  viewToken,
  uploadsPerMinute = 30,
  hosted,
  hostedDeps,
  artifactStorage,
  artifactRetention,
  storybookPreviewBaseUrl,
  storybookPreviewSecret = uploadToken,
}: AppOptions): Hono<AppEnv> {
  // Sliding-window upload rate limit, keyed by presented token.
  const uploadWindows = new Map<string, number[]>();
  const rateLimited = (key: string): boolean => {
    const now = Date.now();
    const window = (uploadWindows.get(key) ?? []).filter((t) => now - t < 60_000);
    if (window.length >= uploadsPerMinute) {
      uploadWindows.set(key, window);
      return true;
    }
    window.push(now);
    uploadWindows.set(key, window);
    if (uploadWindows.size > 10_000) uploadWindows.clear(); // memory backstop
    return false;
  };

  const app = new Hono<AppEnv>();

  const bearer = (header: string | undefined): string | null => {
    const match = /^Bearer\s+(.+)$/.exec(header ?? "");
    return match ? match[1]!.trim() : null;
  };
  const previewBase = storybookPreviewBaseUrl?.replace(/\/+$/, "");
  const previewOrigin = previewBase ? new URL(previewBase).origin : null;
  const previewHost = previewBase ? new URL(previewBase).host.toLowerCase() : null;
  if (hosted && previewOrigin === new URL(hosted.baseUrl).origin) {
    throw new Error("COVALLABY_PREVIEW_BASE_URL must use a separate origin from Covallaby.");
  }
  const previewToken = (id: number, expires: number) =>
    `${expires}.${createHmac("sha256", storybookPreviewSecret)
      .update(`storybook-preview:${id}:${expires}`)
      .digest("base64url")}`;
  const validPreviewToken = (id: number, supplied: string): boolean => {
    const expires = Number(supplied.split(".", 1)[0]);
    if (!Number.isSafeInteger(expires) || expires < Math.floor(Date.now() / 1000)) return false;
    return tokenEquals(supplied, previewToken(id, expires));
  };
  const previewPath = (raw: unknown): string | null => {
    if (typeof raw !== "string" || raw.length === 0 || raw.length > 500) return null;
    if (raw.startsWith("/") || raw.includes("\\") || raw.includes("\0")) return null;
    const parts = raw.split("/");
    return parts.some((part) => !part || part === "." || part === "..") ? null : raw;
  };
  // Hosted tier (opt-in): sign-in, billing, and per-account read scoping.
  // Mounted before the API routes so its gate runs first. Off in self-hosted.
  if (hosted) mountHosted(app, store, hosted, hostedDeps);

  // Optional read gate for everything except health + upload.
  app.use("*", async (c, next) => {
    if (!viewToken) return next();
    const path = c.req.path;
    // Exact match — startsWith would leak /api/v1/uploads/:id past the gate.
    const artifactWrite =
      c.req.method !== "GET" &&
      (path.startsWith("/api/v1/test-runs") || path.startsWith("/api/v1/storybook-previews"));
    if (path === "/healthz" || path === "/api/v1/upload" || path.startsWith("/p/") || artifactWrite)
      return next();
    const provided =
      bearer(c.req.header("authorization")) ??
      c.req.query("token") ??
      getTokenCookie(c.req.header("cookie")) ??
      "";
    if (!tokenEquals(provided, viewToken)) {
      return c.text("Unauthorized. Pass ?token=… or an Authorization: Bearer header.", 401);
    }
    // Remember the token so SPA asset/API requests keep working.
    if (c.req.query("token")) {
      c.header(
        "Set-Cookie",
        `covallaby_view=${c.req.query("token")}; Path=/; HttpOnly; SameSite=Lax`,
      );
    }
    return next();
  });

  app.get("/healthz", (c) => c.json({ ok: true }));

  app.post("/api/v1/upload", async (c) => {
    const token = bearer(c.req.header("authorization"));
    if (!token) {
      return c.json({ ok: false, error: "Missing upload token." }, 401);
    }
    const repo = c.req.query("repo") ?? "";
    if (!REPO_RE.test(repo)) {
      return c.json(
        { ok: false, error: 'Pass ?repo=owner/name (letters, digits, ".", "-", "_").' },
        400,
      );
    }
    const repoToken = await store.getRepoToken(repo);
    const authorized =
      tokenEquals(token, uploadToken) || (repoToken !== null && tokenEquals(token, repoToken));
    if (!authorized) {
      return c.json({ ok: false, error: "Invalid upload token for this repository." }, 401);
    }
    if (rateLimited(token)) {
      return c.json(
        { ok: false, error: `Rate limited: at most ${uploadsPerMinute} uploads per minute.` },
        429,
      );
    }
    const branch = (c.req.query("branch") ?? "main").slice(0, 200);
    const commit = (c.req.query("commit") ?? "unknown").slice(0, 64);
    const prRaw = c.req.query("pr");
    const pr = prRaw && /^\d+$/.test(prRaw) ? Number(prRaw) : null;

    const body = await c.req.text();
    if (body.length === 0) {
      return c.json(
        { ok: false, error: "Empty body. Send the raw coverage file as the request body." },
        400,
      );
    }
    if (body.length > MAX_UPLOAD_BYTES) {
      return c.json({ ok: false, error: "Coverage file exceeds the 50 MB limit." }, 413);
    }

    try {
      const format = c.req.query("format");
      // Exclude generated/vendored/test paths: ?ignore=<newline/comma globs>.
      const ignore = (c.req.query("ignore") ?? "")
        .split(/[\n,]/)
        .map((p) => p.trim())
        .filter((p) => p !== "");
      const report = ignorePaths(
        parseCoverage(body, {
          ...(format && { format: format as never }),
          ...(c.req.query("strip-prefix") && { stripPrefix: c.req.query("strip-prefix")! }),
        }),
        ignore,
      );
      // Opt-in merge: sharded CI jobs each POST their partial coverage with
      // ?merge=1; we accumulate them into one upload for the commit instead of
      // last-write-wins. Without it, every upload is its own snapshot as before.
      const wantMerge = /^(1|true)$/i.test(c.req.query("merge") ?? "");
      const existing = wantMerge ? await store.findByCommit(repo, commit) : null;

      const finalReport = existing ? mergeReports([existing.report, report]) : report;
      const summary = summarize(finalReport);
      const counts = {
        report: finalReport,
        linesCovered: summary.lines.covered,
        linesTotal: summary.lines.total,
        files: summary.totalFiles,
      };
      const row = existing
        ? await store.updateReport(existing.row.id, counts)
        : await store.recordUpload({ repo, branch, commit, pr, ...counts });
      return c.json({
        ok: true,
        id: row.id,
        repo: row.repo,
        branch: row.branch,
        commit: row.commit,
        percent: row.percent,
        merged: existing !== null,
        url: `/r/${row.repo}/u/${row.id}`,
      });
    } catch (error) {
      if (error instanceof ParseError) {
        return c.json({ ok: false, error: error.message }, 422);
      }
      throw error;
    }
  });

  const artifactReady = () =>
    artifactStorage &&
    store.createTestRun &&
    store.createTestArtifact &&
    store.completeTestRun &&
    store.getTestRun &&
    store.listTestRuns;
  const previewReady = () =>
    artifactReady() && previewBase && store.getTestRunRow && store.getTestArtifactByName;
  const uploadAuthorized = async (repo: string, token: string | null): Promise<boolean> => {
    if (!token) return false;
    const repoToken = await store.getRepoToken(repo);
    return tokenEquals(token, uploadToken) || (repoToken !== null && tokenEquals(token, repoToken));
  };

  app.post("/api/v1/test-runs", async (c) => {
    if (!artifactReady())
      return c.json(
        { ok: false, error: "Test artifact storage is not available in this runtime." },
        503,
      );
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "Body must be a JSON run manifest." }, 400);
    }
    const repo = typeof body.repo === "string" ? body.repo : "";
    if (!REPO_RE.test(repo)) return c.json({ ok: false, error: "Pass repo as owner/name." }, 400);
    if (!(await uploadAuthorized(repo, bearer(c.req.header("authorization"))))) {
      return c.json({ ok: false, error: "Invalid upload token for this repository." }, 401);
    }
    const rawArtifacts = Array.isArray(body.artifacts) ? body.artifacts : [];
    if (rawArtifacts.length === 0 || rawArtifacts.length > 200) {
      return c.json({ ok: false, error: "A run must contain 1–200 artifacts." }, 400);
    }
    const parsed: Array<{
      name: string;
      kind: TestArtifactKind;
      contentType: string;
      sizeBytes: number;
      testName: string | null;
    }> = [];
    let totalBytes = 0;
    for (const item of rawArtifacts) {
      if (!item || typeof item !== "object")
        return c.json({ ok: false, error: "Every artifact must be an object." }, 400);
      const a = item as Record<string, unknown>;
      const name = typeof a.name === "string" ? a.name.trim().slice(0, 240) : "";
      const kind =
        typeof a.kind === "string" && ARTIFACT_KINDS.has(a.kind as TestArtifactKind)
          ? (a.kind as TestArtifactKind)
          : null;
      const contentType =
        typeof a.contentType === "string" ? a.contentType.trim().slice(0, 120) : "";
      const sizeBytes = Number(a.sizeBytes);
      if (
        !name ||
        !kind ||
        !contentType ||
        /[\r\n]/.test(contentType) ||
        !Number.isSafeInteger(sizeBytes) ||
        sizeBytes < 0 ||
        sizeBytes > MAX_ARTIFACT_BYTES
      ) {
        return c.json(
          {
            ok: false,
            error: "Artifact name, kind, contentType, or sizeBytes is invalid (500 MB max each).",
          },
          400,
        );
      }
      totalBytes += sizeBytes;
      parsed.push({
        name,
        kind,
        contentType,
        sizeBytes,
        testName: typeof a.testName === "string" ? a.testName.slice(0, 500) : null,
      });
    }
    if (totalBytes > MAX_RUN_BYTES)
      return c.json({ ok: false, error: "Run artifacts exceed the 2 GB limit." }, 413);
    const count = (name: string) =>
      Number.isSafeInteger(Number(body[name])) && Number(body[name]) >= 0 ? Number(body[name]) : 0;
    const run = await store.createTestRun!({
      repo,
      branch: typeof body.branch === "string" ? body.branch.slice(0, 200) : "main",
      commit: typeof body.commit === "string" ? body.commit.slice(0, 64) : "unknown",
      pr: Number.isSafeInteger(Number(body.pr)) && Number(body.pr) > 0 ? Number(body.pr) : null,
      framework: typeof body.framework === "string" ? body.framework.slice(0, 80) : "playwright",
      testsPassed: count("testsPassed"),
      testsFailed: count("testsFailed"),
      testsSkipped: count("testsSkipped"),
      durationMs: count("durationMs"),
    });
    const origin = new URL(c.req.url).origin;
    const artifacts = [];
    for (const item of parsed) {
      const objectKey = artifactObjectKey(repo, run.id, item.name);
      const artifact = await store.createTestArtifact!({ runId: run.id, objectKey, ...item });
      const signed = await artifactStorage!.createUploadUrl(objectKey, item.contentType);
      artifacts.push({
        ...artifact,
        objectKey: undefined,
        uploadUrl:
          signed ?? `${origin}/api/v1/test-runs/${run.id}/artifacts/${artifact.id}/content`,
      });
    }
    return c.json({ ok: true, run, artifacts, url: `/r/${repo}/test-runs/${run.id}` }, 201);
  });

  app.put("/api/v1/test-runs/:runId/artifacts/:artifactId/content", async (c) => {
    if (!artifactReady() || artifactStorage!.kind !== "local")
      return c.json({ ok: false, error: "Direct server uploads are disabled." }, 404);
    const found = await store.getTestRun!(Number(c.req.param("runId")));
    const artifact = found?.artifacts.find((a) => a.id === Number(c.req.param("artifactId")));
    if (!found || !artifact) return c.json({ ok: false, error: "Unknown artifact." }, 404);
    if (!(await uploadAuthorized(found.run.repo, bearer(c.req.header("authorization")))))
      return c.json({ ok: false, error: "Invalid upload token." }, 401);
    const stream = c.req.raw.body;
    if (artifactStorage!.putStream && stream) {
      const matches = await artifactStorage!.putStream(
        artifact.objectKey,
        stream,
        artifact.sizeBytes,
      );
      if (!matches)
        return c.json({ ok: false, error: "Artifact size does not match its manifest." }, 400);
      return c.json({ ok: true });
    }
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.byteLength !== artifact.sizeBytes)
      return c.json({ ok: false, error: "Artifact size does not match its manifest." }, 400);
    await artifactStorage!.put(artifact.objectKey, bytes);
    return c.json({ ok: true });
  });

  app.post("/api/v1/test-runs/:id/complete", async (c) => {
    if (!artifactReady())
      return c.json({ ok: false, error: "Test artifact storage is unavailable." }, 503);
    const found = await store.getTestRun!(Number(c.req.param("id")));
    if (!found) return c.json({ ok: false, error: "Unknown test run." }, 404);
    if (!(await uploadAuthorized(found.run.repo, bearer(c.req.header("authorization")))))
      return c.json({ ok: false, error: "Invalid upload token." }, 401);
    const checks = await Promise.all(
      found.artifacts.map((a) => artifactStorage!.exists(a.objectKey, a.sizeBytes)),
    );
    if (checks.some((ok) => !ok))
      return c.json(
        { ok: false, error: "One or more artifacts are missing or have the wrong size." },
        409,
      );
    const run = await store.completeTestRun!(found.run.id);
    if (artifactRetention && store.deleteTestRun) {
      try {
        await cleanupRepoArtifacts(store, artifactStorage!, found.run.repo, artifactRetention);
      } catch (error) {
        // Maintenance must never turn a successfully uploaded run into a CI failure.
        console.error(`Artifact cleanup failed for ${found.run.repo}:`, error);
      }
    }
    return c.json({ ok: true, run, url: `/r/${found.run.repo}/test-runs/${found.run.id}` });
  });

  app.get("/api/v1/repos/:owner/:name/test-runs", async (c) => {
    if (!artifactReady()) return c.json({ runs: [] });
    return c.json({
      runs: await store.listTestRuns!(`${c.req.param("owner")}/${c.req.param("name")}`, 50),
    });
  });

  app.get("/api/v1/test-runs/:id", async (c) => {
    if (!artifactReady())
      return c.json({ ok: false, error: "Test artifact storage is unavailable." }, 503);
    const found = await store.getTestRun!(Number(c.req.param("id")));
    if (!found) return c.json({ ok: false, error: "Unknown test run." }, 404);
    return c.json({
      run: found.run,
      artifacts: found.artifacts.map(({ objectKey: _, ...a }) => ({
        ...a,
        url: `/api/v1/test-runs/${found.run.id}/artifacts/${a.id}/content`,
      })),
    });
  });

  app.get("/api/v1/test-runs/:runId/artifacts/:artifactId/content", async (c) => {
    if (!artifactReady()) return c.notFound();
    const id = Number(c.req.param("artifactId"));
    const runId = Number(c.req.param("runId"));
    const found = await store.getTestRun!(runId);
    const artifact = found?.artifacts.find((a) => a.id === id);
    if (!artifact) return c.notFound();
    const signed = await artifactStorage!.createDownloadUrl(artifact.objectKey);
    if (signed) return c.redirect(signed, 302);
    const rangeHeader = c.req.header("range");
    let range: { start: number; end: number } | undefined;
    if (rangeHeader) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
      if (!match) {
        c.header("Content-Range", `bytes */${artifact.sizeBytes}`);
        return c.body(null, 416);
      }
      const start = match[1]
        ? Number(match[1])
        : Math.max(0, artifact.sizeBytes - Number(match[2]));
      const end = match[2] && match[1] ? Number(match[2]) : artifact.sizeBytes - 1;
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start < 0 ||
        end < start ||
        start >= artifact.sizeBytes
      ) {
        c.header("Content-Range", `bytes */${artifact.sizeBytes}`);
        return c.body(null, 416);
      }
      range = { start, end: Math.min(end, artifact.sizeBytes - 1) };
    }
    const bytes = await artifactStorage!.get(artifact.objectKey, range);
    c.header("Content-Type", artifact.contentType);
    c.header("Content-Length", String(bytes.byteLength));
    c.header("Accept-Ranges", "bytes");
    c.header("Cache-Control", "private, max-age=300");
    if (range) {
      c.header("Content-Range", `bytes ${range.start}-${range.end}/${artifact.sizeBytes}`);
      return c.body(bytes as Uint8Array<ArrayBuffer>, 206);
    }
    return c.body(bytes as Uint8Array<ArrayBuffer>);
  });

  app.post("/api/v1/storybook-previews", async (c) => {
    if (!previewReady())
      return c.json(
        { ok: false, error: "Storybook preview hosting is not configured on this server." },
        503,
      );
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "Body must be a JSON Storybook manifest." }, 400);
    }
    const repo = typeof body.repo === "string" ? body.repo : "";
    if (!REPO_RE.test(repo)) return c.json({ ok: false, error: "Pass repo as owner/name." }, 400);
    if (!(await uploadAuthorized(repo, bearer(c.req.header("authorization"))))) {
      return c.json({ ok: false, error: "Invalid upload token for this repository." }, 401);
    }
    const rawFiles = Array.isArray(body.files) ? body.files : [];
    if (rawFiles.length === 0 || rawFiles.length > MAX_STORYBOOK_FILES) {
      return c.json(
        { ok: false, error: `A Storybook preview must contain 1–${MAX_STORYBOOK_FILES} files.` },
        400,
      );
    }
    const files: Array<{ path: string; contentType: string; sizeBytes: number }> = [];
    const seen = new Set<string>();
    let totalBytes = 0;
    for (const item of rawFiles) {
      if (!item || typeof item !== "object")
        return c.json({ ok: false, error: "Every preview file must be an object." }, 400);
      const raw = item as Record<string, unknown>;
      const path = previewPath(raw.path);
      const contentType =
        typeof raw.contentType === "string" ? raw.contentType.trim().slice(0, 120) : "";
      const sizeBytes = Number(raw.sizeBytes);
      if (
        !path ||
        !contentType ||
        /[\r\n]/.test(contentType) ||
        seen.has(path) ||
        !Number.isSafeInteger(sizeBytes) ||
        sizeBytes < 0 ||
        sizeBytes > MAX_STORYBOOK_FILE_BYTES
      ) {
        return c.json({ ok: false, error: "Preview path, content type, or size is invalid." }, 400);
      }
      seen.add(path);
      totalBytes += sizeBytes;
      files.push({ path, contentType, sizeBytes });
    }
    if (!seen.has("index.html"))
      return c.json({ ok: false, error: "The Storybook build must contain index.html." }, 400);
    if (totalBytes > MAX_STORYBOOK_BYTES)
      return c.json({ ok: false, error: "Storybook preview exceeds the 1 GB limit." }, 413);

    const run = await store.createTestRun!({
      repo,
      branch: typeof body.branch === "string" ? body.branch.slice(0, 200) : "main",
      commit: typeof body.commit === "string" ? body.commit.slice(0, 64) : "unknown",
      pr: Number.isSafeInteger(Number(body.pr)) && Number(body.pr) > 0 ? Number(body.pr) : null,
      framework: "storybook",
      testsPassed: 0,
      testsFailed: 0,
      testsSkipped: 0,
      durationMs: 0,
    });
    const origin = new URL(c.req.url).origin;
    const artifacts = await Promise.all(
      files.map(async (file) => {
        const objectKey = artifactObjectKey(repo, run.id, file.path);
        const artifact = await store.createTestArtifact!({
          runId: run.id,
          objectKey,
          name: file.path,
          kind: file.path.endsWith(".html") ? "report" : "other",
          contentType: file.contentType,
          sizeBytes: file.sizeBytes,
          testName: null,
        });
        const signed = await artifactStorage!.createUploadUrl(objectKey, file.contentType);
        return {
          path: file.path,
          uploadUrl:
            signed ??
            `${origin}/api/v1/storybook-previews/${run.id}/artifacts/${artifact.id}/content`,
        };
      }),
    );
    return c.json(
      { ok: true, run, artifacts, url: `/r/${repo}/storybook-previews/${run.id}` },
      201,
    );
  });

  app.put("/api/v1/storybook-previews/:runId/artifacts/:artifactId/content", async (c) => {
    if (!previewReady() || artifactStorage!.kind !== "local") return c.notFound();
    const found = await store.getTestRun!(Number(c.req.param("runId")));
    const artifact = found?.artifacts.find((item) => item.id === Number(c.req.param("artifactId")));
    if (!found || found.run.framework !== "storybook" || !artifact) return c.notFound();
    if (!(await uploadAuthorized(found.run.repo, bearer(c.req.header("authorization")))))
      return c.json({ ok: false, error: "Invalid upload token." }, 401);
    const stream = c.req.raw.body;
    if (artifactStorage!.putStream && stream) {
      const matches = await artifactStorage!.putStream(
        artifact.objectKey,
        stream,
        artifact.sizeBytes,
      );
      return matches
        ? c.json({ ok: true })
        : c.json({ ok: false, error: "Preview file size does not match its manifest." }, 400);
    }
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.byteLength !== artifact.sizeBytes)
      return c.json({ ok: false, error: "Preview file size does not match its manifest." }, 400);
    await artifactStorage!.put(artifact.objectKey, bytes);
    return c.json({ ok: true });
  });

  app.post("/api/v1/storybook-previews/:id/complete", async (c) => {
    if (!previewReady()) return c.notFound();
    const found = await store.getTestRun!(Number(c.req.param("id")));
    if (!found || found.run.framework !== "storybook") return c.notFound();
    if (!(await uploadAuthorized(found.run.repo, bearer(c.req.header("authorization")))))
      return c.json({ ok: false, error: "Invalid upload token." }, 401);
    const checks = await Promise.all(
      found.artifacts.map((artifact) =>
        artifactStorage!.exists(artifact.objectKey, artifact.sizeBytes),
      ),
    );
    if (checks.some((exists) => !exists))
      return c.json({ ok: false, error: "One or more preview files are missing." }, 409);
    const run = await store.completeTestRun!(found.run.id);
    if (artifactRetention && store.deleteTestRun) {
      try {
        await cleanupRepoArtifacts(store, artifactStorage!, found.run.repo, artifactRetention);
      } catch (error) {
        console.error(`Artifact cleanup failed for ${found.run.repo}:`, error);
      }
    }
    return c.json({
      ok: true,
      run,
      url: `/r/${found.run.repo}/storybook-previews/${found.run.id}`,
    });
  });

  app.get("/api/v1/repos/:owner/:name/storybook-previews", async (c) => {
    if (!previewReady()) return c.json({ previews: [] });
    const runs = await store.listTestRuns!(`${c.req.param("owner")}/${c.req.param("name")}`, 200);
    return c.json({ previews: runs.filter((run) => run.framework === "storybook").slice(0, 50) });
  });

  app.get("/api/v1/storybook-previews/:id", async (c) => {
    if (!previewReady()) return c.notFound();
    const run = await store.getTestRunRow!(Number(c.req.param("id")));
    if (!run || run.framework !== "storybook") return c.notFound();
    const token = previewToken(run.id, Math.floor(Date.now() / 1000) + 3600);
    return c.json({
      run,
      previewUrl: `${previewBase}/p/${run.id}/index.html?preview_token=${encodeURIComponent(token)}`,
    });
  });

  app.get("/p/:id/*", async (c) => {
    // Match the externally visible host, not the request scheme. TLS commonly
    // terminates at a reverse proxy, so the app may see an http URL for an
    // externally https request. The Host header remains the origin boundary.
    const requestHost = (c.req.header("host") ?? new URL(c.req.url).host).toLowerCase();
    if (!previewReady() || requestHost !== previewHost) return c.notFound();
    const id = Number(c.req.param("id"));
    if (!Number.isSafeInteger(id) || id <= 0) return c.notFound();
    const supplied =
      c.req.query("preview_token") ??
      /(?:^|;\s*)covallaby_preview=([^;]+)/.exec(c.req.header("cookie") ?? "")?.[1] ??
      "";
    if (!validPreviewToken(id, supplied)) return c.text("Preview link expired or is invalid.", 401);
    const run = await store.getTestRunRow!(id);
    if (!run || run.framework !== "storybook" || run.status !== "complete") return c.notFound();
    let requestedPath: string;
    try {
      requestedPath = decodeURIComponent(c.req.path.slice(`/p/${id}/`.length));
    } catch {
      return c.notFound();
    }
    const path = previewPath(requestedPath);
    if (!path) return c.notFound();
    const artifact = await store.getTestArtifactByName!(id, path);
    if (!artifact) return c.notFound();
    if (c.req.query("preview_token")) {
      const securePreview = previewOrigin!.startsWith("https://");
      const cookiePolicy = securePreview ? "SameSite=None; Secure" : "SameSite=Lax";
      c.header(
        "Set-Cookie",
        `covallaby_preview=${supplied}; Path=/p/${id}/; HttpOnly; ${cookiePolicy}; Max-Age=3600`,
      );
      // Exchange the query token for the scoped cookie immediately so it does
      // not remain in browser history, referrers, analytics, or access logs.
      return c.redirect(c.req.path, 302);
    }
    const bytes = await artifactStorage!.get(artifact.objectKey);
    c.header("Content-Type", artifact.contentType);
    c.header("Content-Length", String(bytes.byteLength));
    c.header(
      "Cache-Control",
      artifact.contentType.startsWith("text/html") ? "private, no-store" : "private, max-age=3600",
    );
    c.header("X-Content-Type-Options", "nosniff");
    return c.body(bytes as Uint8Array<ArrayBuffer>);
  });

  app.get("/api/v1/repos", async (c) =>
    c.json({ repos: await store.listRepos(12, c.get("accounts")) }),
  );

  app.get("/api/v1/activity", async (c) =>
    c.json({ uploads: await store.recentUploads(15, c.get("accounts")) }),
  );

  // Mint (or rotate) a per-repo upload token. Admin token required.
  app.post("/api/v1/repos/:owner/:name/token", async (c) => {
    const token = bearer(c.req.header("authorization"));
    if (!token || !tokenEquals(token, uploadToken)) {
      return c.json({ ok: false, error: "Admin upload token required." }, 401);
    }
    const repo = `${c.req.param("owner")}/${c.req.param("name")}`;
    if (!REPO_RE.test(repo)) return c.json({ ok: false, error: "Bad repository name." }, 400);
    const minted = randomBytes(18).toString("base64url");
    await store.setRepoToken(repo, minted);
    return c.json({ ok: true, repo, token: minted });
  });

  app.get("/api/v1/repos/:owner/:name/prs", async (c) => {
    const repo = `${c.req.param("owner")}/${c.req.param("name")}`;
    return c.json({ prs: await store.listPRs(repo, 30) });
  });

  // Compare two uploads: head = ?pr=N (latest upload of that PR) or
  // ?head=<branch> (latest on that branch); base = ?base=<branch> (default main).
  app.get("/api/v1/repos/:owner/:name/compare", async (c) => {
    const repo = `${c.req.param("owner")}/${c.req.param("name")}`;
    const cmp = await resolveComparison(store, repo, {
      base: c.req.query("base"),
      pr: c.req.query("pr"),
      head: c.req.query("head"),
    });
    if ("error" in cmp) return c.json({ ok: false, error: cmp.error }, cmp.status);
    const policy = await loadPolicy(store, repo);
    return c.json({
      head: cmp.head,
      base: cmp.base,
      same: cmp.same,
      changes: cmp.changes,
      policy: judge(policy, cmp).result,
    });
  });

  // Per-repo policy — the "can I merge?" gate. Reading is public (or behind the
  // view gate); writing needs the admin upload token.
  app.get("/api/v1/repos/:owner/:name/policy", async (c) => {
    const repo = `${c.req.param("owner")}/${c.req.param("name")}`;
    return c.json({ repo, policy: await loadPolicy(store, repo) });
  });

  app.put("/api/v1/repos/:owner/:name/policy", async (c) => {
    const token = bearer(c.req.header("authorization"));
    if (!token || !tokenEquals(token, uploadToken)) {
      return c.json({ ok: false, error: "Admin upload token required." }, 401);
    }
    const repo = `${c.req.param("owner")}/${c.req.param("name")}`;
    if (!REPO_RE.test(repo)) return c.json({ ok: false, error: "Bad repository name." }, 400);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "Body must be a JSON policy object." }, 400);
    }
    const policy = parsePolicy(body);
    if (!policy) {
      return c.json(
        {
          ok: false,
          error:
            "No valid rules. Set at least one of minProject, maxDrop, minNewFile (each 0–100).",
        },
        400,
      );
    }
    await store.setMeta(policyKey(repo), JSON.stringify(policy));
    return c.json({ ok: true, repo, policy });
  });

  app.delete("/api/v1/repos/:owner/:name/policy", async (c) => {
    const token = bearer(c.req.header("authorization"));
    if (!token || !tokenEquals(token, uploadToken)) {
      return c.json({ ok: false, error: "Admin upload token required." }, 401);
    }
    const repo = `${c.req.param("owner")}/${c.req.param("name")}`;
    // Clearing == an empty policy; the meta KV has no delete, so store "".
    await store.setMeta(policyKey(repo), "");
    return c.json({ ok: true, repo, policy: null });
  });

  // The merge gate, as JSON. Give it ?pr=N (or ?head=<branch>&base=<branch>)
  // to judge a comparison; with neither, it judges the latest default-branch
  // upload against the one before it. CI gates with:
  //   curl -sf ".../status/o/n.json?pr=$PR" | jq -e .passed
  app.get("/api/v1/repos/:owner/:name/status", async (c) => {
    const repo = `${c.req.param("owner")}/${c.req.param("name")}`;
    return c.json(await computeStatus(store, repo, c.req.query()));
  });

  app.get("/status/:owner/:file", async (c) => {
    const file = c.req.param("file");
    if (!file.endsWith(".svg")) return c.notFound();
    const repo = `${c.req.param("owner")}/${file.slice(0, -4)}`;
    const status = await computeStatus(store, repo, c.req.query());
    const passed = status.configured ? status.passed : null;
    const svg = renderStatusBadge(passed, c.req.query("label") ?? "covallaby");
    c.header("Content-Type", "image/svg+xml");
    c.header("Cache-Control", "no-cache, max-age=120");
    return c.body(svg);
  });

  app.get("/api/v1/repos/:owner/:name/history", async (c) => {
    const repo = `${c.req.param("owner")}/${c.req.param("name")}`;
    const branches = await store.branches(repo);
    if (branches.length === 0) return c.json({ ok: false, error: "Unknown repository." }, 404);
    const preferred = branches.find((b) => b === "main" || b === "master") ?? branches[0]!;
    const branch = c.req.query("branch") ?? preferred;
    return c.json({
      repo,
      branch,
      branches,
      history: await store.history(repo, branch, 200),
    });
  });

  // Portfolio coverage debt over time: for each day any repo uploaded, the
  // covered/total summed across every repo (carrying each repo's last-known
  // value forward). Built from default-branch history — no schema, no source.
  app.get("/api/v1/trends", async (c) => {
    const accounts = c.get("accounts");
    const overviews = await store.listRepos(1, accounts);
    const perRepo = await Promise.all(
      overviews.map(async (o) => {
        const branch = defaultBranch(await store.branches(o.repo), o.latest.branch);
        const hist = await store.history(o.repo, branch, 60);
        return hist
          .map((u) => ({
            t: Date.parse(u.createdAt),
            covered: u.linesCovered,
            total: u.linesTotal,
          }))
          .filter((p) => Number.isFinite(p.t));
      }),
    );
    const DAY = 86_400_000;
    const dayOf = (t: number) => Math.floor(t / DAY) * DAY;
    const days = [...new Set(perRepo.flat().map((p) => dayOf(p.t)))]
      .sort((a, b) => a - b)
      .slice(-24);
    const series = days.map((day) => {
      const end = day + DAY - 1;
      let covered = 0;
      let total = 0;
      for (const repo of perRepo) {
        let best: { t: number; covered: number; total: number } | null = null;
        for (const p of repo) if (p.t <= end && (!best || p.t > best.t)) best = p;
        if (best) {
          covered += best.covered;
          total += best.total;
        }
      }
      return { t: day, covered, total, percent: total === 0 ? null : (covered / total) * 100 };
    });
    return c.json({ series });
  });

  // Covered lines by top-level directory across a branch's recent uploads —
  // the streamgraph source. Rolls up each stored report; capped at 12 points.
  app.get("/api/v1/repos/:owner/:name/dir-trends", async (c) => {
    const repo = `${c.req.param("owner")}/${c.req.param("name")}`;
    const branches = await store.branches(repo);
    if (branches.length === 0) return c.json({ ok: false, error: "Unknown repository." }, 404);
    const branch = c.req.query("branch") ?? defaultBranch(branches, "main");
    const hist = (await store.history(repo, branch, 12)).slice().reverse(); // oldest → newest
    const steps: Array<{ t: number; commit: string }> = [];
    const byDir = new Map<string, number[]>();
    for (let i = 0; i < hist.length; i++) {
      const u = hist[i]!;
      steps.push({ t: Date.parse(u.createdAt), commit: u.commit });
      const full = await store.getUpload(u.id);
      if (!full) continue;
      for (const f of summarize(full.report).files) {
        const top = f.path.split("/")[0] || f.path;
        if (!byDir.has(top)) byDir.set(top, new Array(hist.length).fill(0));
        const arr = byDir.get(top)!;
        arr[i] = (arr[i] ?? 0) + f.lines.covered;
      }
    }
    const dirs = [...byDir.entries()]
      .sort((a, b) => (b[1][b[1].length - 1] ?? 0) - (a[1][a[1].length - 1] ?? 0))
      .slice(0, 6)
      .map(([dir, values]) => ({ dir, values }));
    return c.json({ repo, branch, steps, dirs });
  });

  app.get("/api/v1/uploads/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.json({ ok: false, error: "Bad id." }, 400);
    const found = await store.getUpload(id);
    if (!found) return c.json({ ok: false, error: "Unknown upload." }, 404);
    const summary = summarize(found.report);
    const missingByPath = new Map(
      found.report.files.map((f) => [f.path, formatRanges(uncoveredRanges(f))]),
    );
    const covByPath = new Map(found.report.files.map((f) => [f.path, coverageBitmap(f)]));

    // What changed vs the previous upload on this branch.
    const prev = await store.prevUpload(found.row.repo, found.row.branch, found.row.id);
    let changes: unknown = null;
    if (prev) {
      const before = new Map(summarize(prev.report).files.map((f) => [f.path, f.lines]));
      const added: Array<{ path: string; percent: number | null; total: number }> = [];
      const changed: Array<{
        path: string;
        before: number | null;
        after: number | null;
        delta: number;
      }> = [];
      for (const f of summary.files) {
        const b = before.get(f.path);
        if (!b) {
          added.push({ path: f.path, percent: f.lines.percent, total: f.lines.total });
        } else if (
          f.lines.percent !== null &&
          b.percent !== null &&
          Math.abs(f.lines.percent - b.percent) >= 0.05
        ) {
          changed.push({
            path: f.path,
            before: b.percent,
            after: f.lines.percent,
            delta: f.lines.percent - b.percent,
          });
        }
        before.delete(f.path);
      }
      changed.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
      added.sort((a, b) => (a.percent ?? 101) - (b.percent ?? 101));
      changes = {
        prevCommit: prev.row.commit,
        prevPercent: prev.row.percent,
        added,
        removed: before.size,
        changed: changed.slice(0, 100),
      };
    }
    return c.json({
      changes,
      row: found.row,
      totals: {
        lines: summary.lines,
        functions: summary.functions,
        branches: summary.branches,
        files: summary.totalFiles,
      },
      directories: rollupByDirectory(summary).map((d) => ({
        path: d.path,
        covered: d.lines.covered,
        total: d.lines.total,
        percent: d.lines.percent,
      })),
      files: [...summary.files]
        .sort((a, b) => (a.lines.percent ?? 101) - (b.lines.percent ?? 101))
        .map((f) => ({
          path: f.path,
          covered: f.lines.covered,
          total: f.lines.total,
          percent: f.lines.percent,
          missing: missingByPath.get(f.path) ?? "",
          cov: covByPath.get(f.path) ?? "",
        })),
    });
  });

  app.get("/badge/:owner/:file", async (c) => {
    const file = c.req.param("file");
    if (!file.endsWith(".svg")) return c.notFound();
    const repo = `${c.req.param("owner")}/${file.slice(0, -4)}`;
    const branch = c.req.query("branch");
    const latest = await store.latest(repo, branch);
    const svg = renderBadge(latest?.percent ?? null, c.req.query("label") ?? "coverage");
    c.header("Content-Type", "image/svg+xml");
    c.header("Cache-Control", "no-cache, max-age=120");
    return c.body(svg);
  });

  // The SPA/dashboard catch-all is attached by the runtime entry point
  // (Node serves built files; the Worker serves from its Assets binding), so
  // createApp itself stays runtime-agnostic — no node:fs, no @hono/node-server.
  return app;
}

function getTokenCookie(cookie: string | undefined): string | null {
  const match = /(?:^|;\s*)covallaby_view=([^;]+)/.exec(cookie ?? "");
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return null; // malformed percent-encoding shouldn't 500 the request
  }
}
