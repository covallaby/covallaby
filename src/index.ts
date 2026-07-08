import { serve } from "@hono/node-server";
import { createApp, ensureUploadToken } from "./app.js";
import { openStore } from "./store.js";

const store = await openStore();
const uploadToken = await ensureUploadToken(store, process.env.COVALLABY_TOKEN);
const viewToken = process.env.COVALLABY_VIEW_TOKEN?.trim();

const app = createApp({
  store,
  uploadToken,
  ...(viewToken && { viewToken }),
});

const port = Number(process.env.PORT ?? 8080);
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" });

console.log(`🦘 Covallaby server listening on :${port}`);
console.log(
  `   storage: ${process.env.DATABASE_URL ? "postgres" : `sqlite (${process.env.COVALLABY_DB ?? "data/covallaby.db"})`}`,
);
if (!process.env.COVALLABY_TOKEN) {
  console.log(`   upload token (set COVALLABY_TOKEN to override): ${uploadToken}`);
}
console.log(
  `   upload:  curl -X POST "http://localhost:${port}/api/v1/upload?repo=you/app&branch=main&commit=abc123" -H "Authorization: Bearer <token>" --data-binary @coverage/lcov.info`,
);

const shutdown = async () => {
  await store.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
