import { createApp, ensureUploadToken } from "./app.js";
import { loadHostedConfig } from "./hosted/index.js";
import { type D1Database, D1Store } from "./store/d1.js";

/**
 * Cloudflare Workers entry point. Runs the same core app on D1 (edge SQLite)
 * and serves the dashboard from the Assets binding. No node:sqlite, no
 * filesystem, no Postgres driver — those never get imported on this path.
 */
export interface Env {
  DB: D1Database;
  ASSETS: { fetch(request: Request): Promise<Response> };
  COVALLABY_TOKEN?: string;
  COVALLABY_VIEW_TOKEN?: string;
  [key: string]: unknown;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

type App = ReturnType<typeof createApp>;
let cached: Promise<App> | null = null;

async function build(env: Env): Promise<App> {
  const store = new D1Store(env.DB);
  const uploadToken = await ensureUploadToken(store, env.COVALLABY_TOKEN);
  const viewToken = env.COVALLABY_VIEW_TOKEN?.trim();
  const hosted = loadHostedConfig(env as unknown as NodeJS.ProcessEnv);

  const app = createApp({
    store,
    uploadToken,
    ...(viewToken && { viewToken }),
    ...(hosted && { hosted }),
  });

  // SPA/dashboard fallback from the Assets binding — attached last, after every
  // API/badge/health route. A miss (client-side route) falls back to index.html.
  app.get("*", async (c) => {
    const res = await env.ASSETS.fetch(c.req.raw);
    if (res.status !== 404) return res;
    const url = new URL(c.req.url);
    url.pathname = "/";
    return env.ASSETS.fetch(new Request(url.toString(), c.req.raw));
  });
  return app;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Build once per isolate; bindings are only available inside fetch().
    if (!cached) cached = build(env);
    const app = await cached;
    return app.fetch(request, env, ctx as unknown as Parameters<App["fetch"]>[2]);
  },
};
