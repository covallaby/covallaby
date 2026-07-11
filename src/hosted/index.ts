import { createHmac, timingSafeEqual } from "node:crypto";
import type { Hono } from "hono";
import { recordPRRetentionState, recordRepoRetentionState } from "../retention.js";
import type { Store } from "../store.js";
import { authRoutes, currentSession } from "./auth.js";
import { billingRoutes } from "./billing.js";
import type { HostedConfig } from "./config.js";
import { type GitHubClient, createGitHubClient } from "./github.js";

export { loadHostedConfig, type HostedConfig } from "./config.js";

/** Hono env with the per-request account scope the hosted gate sets. */
export type AppEnv = { Variables: { accounts?: string[] } };

// re-exported for AppOptions typing
export interface HostedDeps {
  github?: GitHubClient; // injectable for tests
}

/**
 * Mount the hosted tier onto the app. Called only when a HostedConfig exists,
 * so the self-hosted server never touches any of this. Adds:
 *  - Sign in with GitHub (+ /api/v1/me)
 *  - Billing routes (OSS ships a free-only stub; the hosted tier overlays Stripe)
 *  - a read gate: cross-repo/read endpoints require a session and are scoped to
 *    the signed-in user's GitHub accounts. Uploads (token-authed) are untouched.
 */
export function mountHosted(
  app: Hono<AppEnv>,
  store: Store,
  config: HostedConfig,
  deps: HostedDeps = {},
): void {
  const github = deps.github ?? createGitHubClient(config);

  app.route("/", authRoutes(config, github));
  app.route("/", billingRoutes(config, store));

  if (config.github.webhookSecret) {
    app.post("/api/v1/github/webhook", async (c) => {
      const body = await c.req.text();
      const supplied = c.req.header("x-hub-signature-256") ?? "";
      const expected = `sha256=${createHmac("sha256", config.github.webhookSecret!).update(body).digest("hex")}`;
      const a = Buffer.from(supplied);
      const b = Buffer.from(expected);
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        return c.json({ ok: false, error: "Invalid GitHub webhook signature." }, 401);
      }
      let payload: {
        action?: string;
        number?: number;
        pull_request?: { closed_at?: string | null };
        repository?: { full_name?: string; default_branch?: string };
      };
      try {
        payload = JSON.parse(body);
      } catch {
        return c.json({ ok: false, error: "Invalid GitHub webhook payload." }, 400);
      }
      const repo = payload.repository?.full_name;
      if (repo && payload.repository?.default_branch) {
        await recordRepoRetentionState(store, repo, payload.repository.default_branch);
      }
      if (repo && payload.number && payload.pull_request) {
        const open = payload.action !== "closed";
        await recordPRRetentionState(
          store,
          repo,
          payload.number,
          open,
          open ? null : (payload.pull_request.closed_at ?? new Date().toISOString()),
        );
      }
      return c.json({ ok: true });
    });
  }

  // Read gate: browsing endpoints require a session; scope them to the user's
  // accounts. Uploads, badges, health, auth, and the SPA shell are exempt.
  app.use("/api/v1/*", async (c, next) => {
    const path = c.req.path;
    const artifactWrite = c.req.method !== "GET" && path.startsWith("/api/v1/test-runs");
    const open =
      path === "/api/v1/upload" ||
      path === "/api/v1/github/webhook" ||
      artifactWrite ||
      path.startsWith("/api/v1/billing/") ||
      path === "/api/v1/me";
    if (open) return next();

    const session = currentSession(c.req.header("cookie"), config.sessionSecret);
    if (!session) return c.json({ ok: false, error: "Sign in to view coverage." }, 401);

    // For a repo-scoped route, enforce the repo's account is one the user can see.
    const repoMatch = /^\/api\/v1\/repos\/([^/]+)\/([^/]+)/.exec(path);
    if (repoMatch && !session.accounts.includes(repoMatch[1]!)) {
      return c.json({ ok: false, error: "Not found." }, 404);
    }
    const uploadMatch = /^\/api\/v1\/uploads\/(\d+)/.exec(path);
    if (uploadMatch) {
      const found = await store.getUpload(Number(uploadMatch[1]));
      if (found && !session.accounts.includes(found.row.repo.split("/")[0]!)) {
        return c.json({ ok: false, error: "Not found." }, 404);
      }
    }
    const runMatch = /^\/api\/v1\/test-runs\/(\d+)/.exec(path);
    if (runMatch && store.getTestRun) {
      const found = await store.getTestRun(Number(runMatch[1]));
      if (found && !session.accounts.includes(found.run.repo.split("/")[0]!)) {
        return c.json({ ok: false, error: "Not found." }, 404);
      }
    }
    // Stash accounts so list/activity handlers can scope (read in app.ts).
    c.set("accounts", session.accounts);
    return next();
  });
}
