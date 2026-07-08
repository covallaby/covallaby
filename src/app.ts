import { randomBytes, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { homePage, repoPage, uploadPage } from "./pages.js";
import type { Store } from "./store.js";
import { renderBadge } from "./vendor/badge.js";
import { summarize } from "./vendor/model.js";
import { ParseError, parseCoverage } from "./vendor/parsers/index.js";

export interface AppOptions {
  store: Store;
  uploadToken: string;
  /** Optional read gate; unset = dashboard is public. */
  viewToken?: string;
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

export function createApp({ store, uploadToken, viewToken }: AppOptions): Hono {
  const app = new Hono();

  const bearer = (header: string | undefined): string | null => {
    const match = /^Bearer\s+(.+)$/.exec(header ?? "");
    return match ? match[1]!.trim() : null;
  };

  // Optional read gate for everything except health + upload.
  app.use("*", async (c, next) => {
    if (!viewToken) return next();
    const path = c.req.path;
    if (path === "/healthz" || path.startsWith("/api/v1/upload")) return next();
    const provided = bearer(c.req.header("authorization")) ?? c.req.query("token") ?? "";
    if (!tokenEquals(provided, viewToken)) {
      return c.text("Unauthorized. Pass ?token=… or an Authorization: Bearer header.", 401);
    }
    return next();
  });

  app.get("/healthz", (c) => c.json({ ok: true }));

  app.post("/api/v1/upload", async (c) => {
    const token = bearer(c.req.header("authorization"));
    if (!token || !tokenEquals(token, uploadToken)) {
      return c.json({ ok: false, error: "Missing or invalid upload token." }, 401);
    }
    const repo = c.req.query("repo") ?? "";
    if (!REPO_RE.test(repo)) {
      return c.json(
        { ok: false, error: 'Pass ?repo=owner/name (letters, digits, ".", "-", "_").' },
        400,
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

  app.get("/api/v1/repos", async (c) => c.json({ repos: await store.listRepos(12) }));

  app.get("/api/v1/repos/:owner/:name/history", async (c) => {
    const repo = `${c.req.param("owner")}/${c.req.param("name")}`;
    const branch = c.req.query("branch") ?? (await store.latest(repo))?.branch;
    if (!branch) return c.json({ ok: false, error: "Unknown repository." }, 404);
    return c.json({ repo, branch, history: await store.history(repo, branch, 200) });
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

  app.get("/", async (c) => c.html(homePage(await store.listRepos(12))));

  app.get("/r/:owner/:name", async (c) => {
    const repo = `${c.req.param("owner")}/${c.req.param("name")}`;
    const branches = await store.branches(repo);
    if (branches.length === 0) return c.notFound();
    const branch = c.req.query("branch") ?? branches[0]!;
    const history = await store.history(repo, branch, 60);
    return c.html(repoPage(repo, branch, branches, history));
  });

  app.get("/r/:owner/:name/u/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.notFound();
    const found = await store.getUpload(id);
    if (!found) return c.notFound();
    return c.html(uploadPage(found.row, found.report));
  });

  return app;
}
