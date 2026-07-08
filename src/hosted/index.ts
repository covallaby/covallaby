import type { Hono } from "hono";
import type { Store } from "../store.js";
import { authRoutes, currentSession } from "./auth.js";
import { type BillingClient, billingRoutes, createStripeClient } from "./billing.js";
import type { HostedConfig } from "./config.js";
import { type GitHubClient, createGitHubClient } from "./github.js";

export { loadHostedConfig, type HostedConfig } from "./config.js";

/** Hono env with the per-request account scope the hosted gate sets. */
export type AppEnv = { Variables: { accounts?: string[] } };

// re-exported for AppOptions typing
export interface HostedDeps {
  github?: GitHubClient; // injectable for tests
  billing?: BillingClient | null;
}

/**
 * Mount the hosted tier onto the app. Called only when a HostedConfig exists,
 * so the self-hosted server never touches any of this. Adds:
 *  - Sign in with GitHub (+ /api/v1/me)
 *  - Stripe billing routes
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
  const billing =
    deps.billing !== undefined
      ? deps.billing
      : config.stripe
        ? createStripeClient(config.stripe)
        : null;

  app.route("/", authRoutes(config, github));
  app.route("/", billingRoutes(config, store, billing));

  // Read gate: browsing endpoints require a session; scope them to the user's
  // accounts. Uploads, badges, health, auth, and the SPA shell are exempt.
  app.use("/api/v1/*", async (c, next) => {
    const path = c.req.path;
    const open =
      path === "/api/v1/upload" || path.startsWith("/api/v1/billing/") || path === "/api/v1/me";
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
    // Stash accounts so list/activity handlers can scope (read in app.ts).
    c.set("accounts", session.accounts);
    return next();
  });
}
