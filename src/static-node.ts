import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Hono } from "hono";
import type { AppEnv } from "./hosted/index.js";

/**
 * Node-only dashboard serving. Kept out of app.ts so the core app stays
 * runtime-agnostic (the Worker serves assets from its Assets binding instead).
 * Attach LAST — the catch-all must come after every API route.
 */
export function attachDashboard(app: Hono<AppEnv>, webDist?: string): void {
  const dist = webDist ?? "web/dist";
  if (existsSync(join(dist, "index.html"))) {
    const index = readFileSync(join(dist, "index.html"), "utf8");
    app.use("/assets/*", serveStatic({ root: dist }));
    app.get("*", (c) => c.html(index));
  } else {
    app.get("*", (c) =>
      c.text(
        "Covallaby server is running, but the dashboard isn't built. Run `pnpm build` (or use the Docker image). The API at /api/v1/* works regardless.",
        200,
      ),
    );
  }
}
