import { serve } from "@hono/node-server";
import { createApp, ensureUploadToken } from "./app.js";
import { openArtifactStorage } from "./artifacts.js";
import { loadHostedConfig } from "./hosted/index.js";
import { loadArtifactRetention } from "./retention.js";
import { attachDashboard } from "./static-node.js";
import { openStore } from "./store.js";

const store = await openStore();
const uploadToken = await ensureUploadToken(store, process.env.COVALLABY_TOKEN);
const viewToken = process.env.COVALLABY_VIEW_TOKEN?.trim();
const hosted = loadHostedConfig(); // null unless COVALLABY_HOSTED=1
const artifactStorage = openArtifactStorage();
const artifactRetention = loadArtifactRetention();

const app = createApp({
  store,
  uploadToken,
  artifactStorage,
  artifactRetention,
  ...(viewToken && { viewToken }),
  ...(hosted && { hosted }),
});
attachDashboard(app, process.env.COVALLABY_WEB_DIST); // Node serves the built SPA

const port = Number(process.env.PORT ?? 8080);
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" });

console.log(`🦘 Covallaby server listening on :${port}`);
console.log(
  `   storage: ${process.env.DATABASE_URL ? "postgres" : `sqlite (${process.env.COVALLABY_DB ?? "data/covallaby.db"})`}`,
);
console.log(
  `   artifacts: ${artifactStorage.kind === "s3" ? "s3-compatible object storage" : `local (${process.env.COVALLABY_ARTIFACTS_DIR ?? "data/artifacts"})`}`,
);
if (hosted) {
  console.log("   mode:    hosted (GitHub sign-in; billing via the hosted overlay, if present)");
}
if (!process.env.COVALLABY_TOKEN) {
  // A generated admin secret: to stderr with a nudge, not into stdout logs.
  console.error(
    `   ⚠ generated upload token (set COVALLABY_TOKEN to a secret of your own): ${uploadToken}`,
  );
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
