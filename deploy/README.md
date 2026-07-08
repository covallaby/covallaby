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

See each file's header comments for the exact commands.

### A note on Cloudflare

Cloudflare Workers/Pages is **not** a drop-in target for this server. It's an
edge runtime, not Node — no `node:sqlite`, no filesystem, and no TCP for the
Postgres driver, so the server can't run there unchanged. Hono itself is
Cloudflare-native, so a real port is possible: it needs a **D1-backed `Store`
adapter** (Cloudflare's SQLite) plus static assets served from Workers Assets.
That's tracked as a future adapter, not a one-click button — we won't ship a
button that doesn't actually work. For a managed host today, Fly/Render/Heroku
run the real thing in minutes.
