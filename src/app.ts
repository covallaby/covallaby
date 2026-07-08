import { randomBytes, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { type AppEnv, type HostedConfig, type HostedDeps, mountHosted } from "./hosted/index.js";
import type { Store } from "./store.js";
import { renderBadge } from "./vendor/badge.js";
import {
  type CoverageReport,
  formatRanges,
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
}

const REPO_RE = /^[\w.-]+\/[\w.-]+$/;
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

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

export function createApp({
  store,
  uploadToken,
  viewToken,
  uploadsPerMinute = 30,
  hosted,
  hostedDeps,
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

  // Hosted tier (opt-in): sign-in, billing, and per-account read scoping.
  // Mounted before the API routes so its gate runs first. Off in self-hosted.
  if (hosted) mountHosted(app, store, hosted, hostedDeps);

  // Optional read gate for everything except health + upload.
  app.use("*", async (c, next) => {
    if (!viewToken) return next();
    const path = c.req.path;
    // Exact match — startsWith would leak /api/v1/uploads/:id past the gate.
    if (path === "/healthz" || path === "/api/v1/upload") return next();
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
      const report = parseCoverage(body, {
        ...(format && { format: format as never }),
        ...(c.req.query("strip-prefix") && { stripPrefix: c.req.query("strip-prefix")! }),
      });
      const summary = summarize(report);
      const row = await store.recordUpload({
        repo,
        branch,
        commit,
        pr,
        report,
        linesCovered: summary.lines.covered,
        linesTotal: summary.lines.total,
        files: summary.totalFiles,
      });
      return c.json({
        ok: true,
        id: row.id,
        repo: row.repo,
        branch: row.branch,
        commit: row.commit,
        percent: row.percent,
        url: `/r/${row.repo}/u/${row.id}`,
      });
    } catch (error) {
      if (error instanceof ParseError) {
        return c.json({ ok: false, error: error.message }, 422);
      }
      throw error;
    }
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
    const baseBranch = c.req.query("base") ?? "main";
    const prRaw = c.req.query("pr");
    const headBranch = c.req.query("head");

    let headRow = null;
    if (prRaw && /^\d+$/.test(prRaw)) {
      const prs = await store.listPRs(repo, 100);
      headRow = prs.find((p) => p.pr === Number(prRaw))?.latest ?? null;
    } else if (headBranch) {
      headRow = await store.latest(repo, headBranch);
    }
    if (!headRow) return c.json({ ok: false, error: "No uploads found for that head." }, 404);

    const baseRow = await store.latest(repo, baseBranch);
    if (!baseRow) {
      return c.json({ ok: false, error: `No uploads found on base branch "${baseBranch}".` }, 404);
    }
    if (baseRow.id === headRow.id) {
      return c.json({ head: headRow, base: baseRow, same: true, changes: null });
    }
    const head = await store.getUpload(headRow.id);
    const base = await store.getUpload(baseRow.id);
    if (!head || !base) return c.json({ ok: false, error: "Upload vanished." }, 404);
    return c.json({
      head: headRow,
      base: baseRow,
      same: false,
      changes: diffReports(head.report, base.report),
    });
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

  app.get("/api/v1/uploads/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.json({ ok: false, error: "Bad id." }, 400);
    const found = await store.getUpload(id);
    if (!found) return c.json({ ok: false, error: "Unknown upload." }, 404);
    const summary = summarize(found.report);
    const missingByPath = new Map(
      found.report.files.map((f) => [f.path, formatRanges(uncoveredRanges(f))]),
    );

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
