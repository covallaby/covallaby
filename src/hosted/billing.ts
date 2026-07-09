import { Hono } from "hono";
import type { Store } from "../store.js";
import { currentSession } from "./auth.js";
import type { HostedConfig } from "./config.js";

/**
 * Billing stub. The open-source build ships **no payment provider** — every
 * hosted account is on the free plan, and there's no checkout or webhook.
 *
 * Covallaby's commercial hosted tier overlays this single module with a Stripe
 * implementation (checkout, webhooks, plan enforcement). Keeping the seam here
 * means the OSS server stays fully functional and self-hostable — money is the
 * only thing it doesn't know about.
 */
export function billingRoutes(config: HostedConfig, _store: Store): Hono {
  const app = new Hono();

  app.get("/api/v1/billing/plan", (c) => {
    const session = currentSession(c.req.header("cookie"), config.sessionSecret);
    if (!session) return c.json({ ok: false, error: "Sign in first." }, 401);
    return c.json({
      billingEnabled: false,
      plans: session.accounts.map((account) => ({ account, plan: "free" as const })),
    });
  });

  return app;
}
