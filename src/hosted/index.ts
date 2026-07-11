import { createHmac, timingSafeEqual } from "node:crypto";
import type { Hono } from "hono";
import { recordPRRetentionState, recordRepoRetentionState } from "../retention.js";
import type { Store } from "../store.js";
import { authRoutes, currentSession } from "./auth.js";
import { billingRoutes } from "./billing.js";
import type { HostedConfig } from "./config.js";
import {
  type GitHubAppClient,
  clearInstallation,
  createGitHubAppClient,
  installationAccountKey,
  reconcileInstallation,
  recordInstallation,
} from "./github-app.js";
import { type GitHubClient, createGitHubClient } from "./github.js";

export { loadHostedConfig, type HostedConfig } from "./config.js";

/** Hono env with the per-request account scope the hosted gate sets. */
export type AppEnv = { Variables: { accounts?: string[] } };

// re-exported for AppOptions typing
export interface HostedDeps {
  github?: GitHubClient; // injectable for tests
  githubApp?: GitHubAppClient;
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
  const githubApp =
    deps.githubApp ??
    (config.githubApp
      ? createGitHubAppClient({
          appId: config.githubApp.appId,
          privateKey: config.githubApp.privateKey,
          apiBase: config.github.apiBase,
        })
      : null);

  app.route("/", authRoutes(config, github));
  app.route("/", billingRoutes(config, store));

  if (githubApp && config.githubApp) {
    for (const installationId of config.githubApp.bootstrapInstallationIds) {
      void githubApp
        .getInstallation(installationId)
        .then(async (installation) => {
          await recordInstallation(store, installation);
          await reconcileInstallation(store, githubApp, installationId);
        })
        .catch((error) => console.error(`GitHub App bootstrap ${installationId} failed:`, error));
    }

    app.get("/api/v1/github/status", async (c) => {
      const session = currentSession(c.req.header("cookie"), config.sessionSecret);
      if (!session) return c.json({ ok: false, error: "Sign in first." }, 401);
      const accounts = await Promise.all(
        session.accounts.map(async (account) => ({
          account,
          installed: Boolean(await store.getMeta(installationAccountKey(account))),
        })),
      );
      return c.json({ configured: true, slug: config.githubApp!.slug, accounts });
    });

    app.get("/api/v1/github/install", (c) => {
      const session = currentSession(c.req.header("cookie"), config.sessionSecret);
      if (!session) return c.redirect("/auth/github/login");
      return c.redirect(`https://github.com/apps/${config.githubApp!.slug}/installations/new`);
    });

    app.get("/api/v1/github/setup", async (c) => {
      const session = currentSession(c.req.header("cookie"), config.sessionSecret);
      if (!session) return c.redirect("/auth/github/login");
      const installationId = Number(c.req.query("installation_id"));
      if (!Number.isSafeInteger(installationId) || installationId <= 0) {
        return c.text("GitHub did not provide a valid installation.", 400);
      }
      const installation = await githubApp.getInstallation(installationId);
      if (
        !session.accounts.some(
          (account) => account.toLowerCase() === installation.account.toLowerCase(),
        )
      ) {
        return c.text("That GitHub installation is not available to this account.", 403);
      }
      await recordInstallation(store, installation);
      await reconcileInstallation(store, githubApp, installationId);
      return c.redirect("/?github=installed");
    });
  } else {
    app.get("/api/v1/github/status", (c) => c.json({ configured: false, accounts: [] }));
  }

  if (config.github.webhookSecret) {
    app.post("/api/v1/github/webhook", async (c) => {
      const body = await c.req.text();
      const event = c.req.header("x-github-event") ?? "";
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
        installation?: { id: number; account?: { login?: string } };
      };
      try {
        payload = JSON.parse(body);
      } catch {
        return c.json({ ok: false, error: "Invalid GitHub webhook payload." }, 400);
      }
      const repo = payload.repository?.full_name;
      const installationAccount = payload.installation?.account?.login;
      if (
        payload.installation &&
        installationAccount &&
        (event === "installation" || event === "installation_repositories")
      ) {
        const installation = { id: payload.installation.id, account: installationAccount };
        if (event === "installation" && payload.action === "deleted") {
          await clearInstallation(store, installation);
        } else await recordInstallation(store, installation);
        if (githubApp && payload.action !== "deleted") {
          await reconcileInstallation(store, githubApp, installation.id);
        }
      }
      if (repo && payload.repository?.default_branch) {
        await recordRepoRetentionState(store, repo, payload.repository.default_branch);
      }
      if (event === "pull_request" && repo && payload.number && payload.pull_request) {
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
    const artifactWrite =
      c.req.method !== "GET" &&
      (path.startsWith("/api/v1/test-runs") || path.startsWith("/api/v1/storybook-previews"));
    const open =
      path === "/api/v1/upload" ||
      path === "/api/v1/github/webhook" ||
      artifactWrite ||
      path.startsWith("/api/v1/billing/") ||
      path === "/api/v1/me";
    if (open) return next();

    const session = currentSession(c.req.header("cookie"), config.sessionSecret);
    if (!session) return c.json({ ok: false, error: "Sign in to view coverage." }, 401);
    const canSeeAccount = (owner: string) =>
      session.accounts.some((account) => account.toLowerCase() === owner.toLowerCase());

    // For a repo-scoped route, enforce the repo's account is one the user can see.
    const repoMatch = /^\/api\/v1\/repos\/([^/]+)\/([^/]+)/.exec(path);
    if (repoMatch && !canSeeAccount(repoMatch[1]!)) {
      return c.json({ ok: false, error: "Not found." }, 404);
    }
    const uploadMatch = /^\/api\/v1\/uploads\/(\d+)/.exec(path);
    if (uploadMatch) {
      const found = await store.getUpload(Number(uploadMatch[1]));
      if (found && !canSeeAccount(found.row.repo.split("/")[0]!)) {
        return c.json({ ok: false, error: "Not found." }, 404);
      }
    }
    const runMatch = /^\/api\/v1\/(?:test-runs|storybook-previews)\/(\d+)/.exec(path);
    if (runMatch && (store.getTestRunRow || store.getTestRun)) {
      const run = store.getTestRunRow
        ? await store.getTestRunRow(Number(runMatch[1]))
        : (await store.getTestRun!(Number(runMatch[1])))?.run;
      if (run && !canSeeAccount(run.repo.split("/")[0]!)) {
        return c.json({ ok: false, error: "Not found." }, 404);
      }
    }
    // Stash accounts so list/activity handlers can scope (read in app.ts).
    c.set("accounts", session.accounts);
    return next();
  });
}
