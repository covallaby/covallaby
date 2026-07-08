import { createHmac, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import type { Plan, Store, Subscription } from "../store.js";
import { currentSession } from "./auth.js";
import type { HostedConfig } from "./config.js";

/**
 * Billing, deliberately isolated: nothing else in the system knows about money.
 * The Stripe surface we use is an interface so tests inject a fake; live uses
 * the REST API directly (no SDK dependency — one endpoint each).
 */
export interface BillingClient {
  createCheckout(input: {
    account: string;
    email?: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<string>;
  /** Verify a webhook signature and return the parsed event. */
  parseWebhook(body: string, signature: string | undefined): { type: string; data: unknown } | null;
}

/** An account's effective plan: pro only while its subscription is active. */
export async function planFor(store: Store, account: string): Promise<Plan> {
  const sub = await store.getSubscription(account);
  if (!sub) return "free";
  const active = sub.status === "active" || sub.status === "trialing";
  const notExpired = !sub.currentPeriodEnd || new Date(sub.currentPeriodEnd).getTime() > Date.now();
  return sub.plan === "pro" && active && notExpired ? "pro" : "free";
}

export function createStripeClient(config: NonNullable<HostedConfig["stripe"]>): BillingClient {
  const auth = `Bearer ${config.secretKey}`;
  return {
    async createCheckout({ account, email, successUrl, cancelUrl }) {
      const form = new URLSearchParams({
        mode: "subscription",
        "line_items[0][price]": config.priceId,
        "line_items[0][quantity]": "1",
        success_url: successUrl,
        cancel_url: cancelUrl,
        client_reference_id: account,
        "metadata[account]": account,
      });
      if (email) form.set("customer_email", email);
      const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: { authorization: auth, "content-type": "application/x-www-form-urlencoded" },
        body: form,
      });
      const data = (await res.json()) as { url?: string; error?: { message: string } };
      if (!data.url) throw new Error(data.error?.message ?? "Stripe checkout failed");
      return data.url;
    },

    parseWebhook(body, signature) {
      if (!verifyStripeSignature(body, signature, config.webhookSecret)) return null;
      try {
        const evt = JSON.parse(body) as { type: string; data: { object: unknown } };
        return { type: evt.type, data: evt.data.object };
      } catch {
        return null;
      }
    },
  };
}

/** Stripe's `t=…,v1=…` scheme: HMAC-SHA256 over `${t}.${body}`. */
export function verifyStripeSignature(
  body: string,
  header: string | undefined,
  secret: string,
): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((kv) => kv.split("=") as [string, string]),
  );
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  const a = Buffer.from(v1);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function billingRoutes(
  config: HostedConfig,
  store: Store,
  client: BillingClient | null,
): Hono {
  const app = new Hono();

  app.get("/api/v1/billing/plan", async (c) => {
    const session = currentSession(c.req.header("cookie"), config.sessionSecret);
    if (!session) return c.json({ ok: false, error: "Sign in first." }, 401);
    const plans = await Promise.all(
      session.accounts.map(async (a) => ({ account: a, plan: await planFor(store, a) })),
    );
    return c.json({ billingEnabled: client !== null, plans });
  });

  app.post("/api/v1/billing/checkout", async (c) => {
    const session = currentSession(c.req.header("cookie"), config.sessionSecret);
    if (!session) return c.json({ ok: false, error: "Sign in first." }, 401);
    if (!client)
      return c.json({ ok: false, error: "Billing isn't configured on this instance." }, 501);
    const account = c.req.query("account") ?? session.login;
    if (!session.accounts.includes(account)) {
      return c.json({ ok: false, error: "You can't bill for that account." }, 403);
    }
    const url = await client.createCheckout({
      account,
      successUrl: `${config.baseUrl}/?upgraded=1`,
      cancelUrl: `${config.baseUrl}/`,
    });
    return c.json({ ok: true, url });
  });

  app.post("/api/v1/billing/webhook", async (c) => {
    if (!client) return c.json({ ok: false }, 501);
    const body = await c.req.text();
    const event = client.parseWebhook(body, c.req.header("stripe-signature"));
    if (!event) return c.json({ ok: false, error: "Bad signature." }, 400);

    const obj = event.data as {
      client_reference_id?: string;
      customer?: string;
      status?: string;
      current_period_end?: number;
      metadata?: { account?: string };
    };
    const account = obj.metadata?.account ?? obj.client_reference_id;

    if (event.type === "checkout.session.completed" && account) {
      await store.setSubscription({
        account,
        plan: "pro",
        status: "active",
        stripeCustomer: obj.customer ?? null,
        currentPeriodEnd: null,
      });
    } else if (event.type.startsWith("customer.subscription.") && obj.customer) {
      const existing = await store.findSubscriptionByCustomer(obj.customer);
      if (existing) {
        const sub: Subscription = {
          ...existing,
          status: obj.status ?? existing.status,
          plan: obj.status === "canceled" ? "free" : "pro",
          currentPeriodEnd: obj.current_period_end
            ? new Date(obj.current_period_end * 1000).toISOString()
            : existing.currentPeriodEnd,
        };
        await store.setSubscription(sub);
      }
    }
    return c.json({ ok: true });
  });

  return app;
}
