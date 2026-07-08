# Deploy templates

One-click / few-command deploys for the Covallaby server. Every platform runs
the same `Dockerfile`; the only real choice is **storage durability**:

- **SQLite (default)** needs a persistent disk/volume mounted at `/data`. Great
  for a single always-on machine. Fly and Render templates set this up.
- **Postgres** — set `DATABASE_URL` instead and you don't need a disk. Required
  on platforms with ephemeral filesystems (DigitalOcean App Platform, scale-to-zero
  setups that don't keep the volume).

Always set `COVALLABY_TOKEN` to a secret of your own (or read the generated one
from the logs on first boot).

| Platform | Template | Storage |
|---|---|---|
| **Fly.io** | [`fly.toml`](fly.toml) | SQLite on a volume (or Fly Postgres) |
| **Render** | [`render.yaml`](render.yaml) | SQLite on a disk |
| **Heroku** | [`app.json`](../app.json) + [`heroku.yml`](../heroku.yml) | Postgres addon (auto `DATABASE_URL`) |
| **DigitalOcean** | [`digitalocean.app.yaml`](digitalocean.app.yaml) | Postgres (ephemeral FS) |
| **Railway / Koyeb / any Docker host** | the root `Dockerfile` | your volume or Postgres |
| **Cloudflare Workers** | [`wrangler.toml`](../wrangler.toml) + [`D1Store`](../src/store/d1.ts) | D1 (edge SQLite) |

See each file's header comments for the exact commands.

### Cloudflare Workers + D1 (edge)

Covallaby runs on Cloudflare's edge too, on **D1** (Cloudflare's SQLite). Same
core app — a dedicated [`D1Store`](../src/store/d1.ts) driver and a
[Workers entry point](../src/worker.ts) that serves the dashboard from the
Assets binding. No `node:sqlite`, no filesystem, no Postgres driver on this path.

```bash
npx wrangler d1 create covallaby        # paste the database_id into wrangler.toml
pnpm build                              # compiles src → dist (incl. worker.js)
npx wrangler secret put COVALLABY_TOKEN # your CI upload token
npx wrangler deploy                     # bundles dist/worker.js + web/dist assets
```

Config lives in [`wrangler.toml`](../wrangler.toml). The D1 schema is created
lazily on the first request — no migration step. Scales to zero, runs on
Cloudflare's free tier, and the hosted tier (`COVALLABY_HOSTED=1` + secrets)
works here too.
