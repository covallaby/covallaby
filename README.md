# 🦘 Covallaby Server

[![CI](https://github.com/covallaby/server/actions/workflows/ci.yml/badge.svg)](https://github.com/covallaby/server/actions/workflows/ci.yml)

**Self-hosted coverage history, dashboards, and live badges — one tiny
process.** The optional companion to the
[Covallaby GitHub Action](https://github.com/covallaby/covallaby), which never
requires it. Run this when you want coverage *over time* and a badge URL for
your README.

- **One process, one file.** Node 22 + built-in SQLite. No Postgres required,
  no Redis, no object storage, no client build. ~50 MB RAM.
- **Postgres when you want it.** Set `DATABASE_URL` and it uses your managed
  Postgres instead — same features, zero code changes.
- **Runs nearly anywhere.** A $4 VPS, Fly.io's smallest machine, a Raspberry
  Pi, `docker run`. Zero native dependencies.

## Quick start

```bash
git clone https://github.com/covallaby/server covallaby-server
cd covallaby-server
docker compose up -d
docker compose logs | grep "upload token"   # note the generated token
```

Or without Docker (Node ≥ 22.5):

```bash
corepack enable pnpm && pnpm install && pnpm build && pnpm start
```

Then upload coverage from CI (any format Covallaby understands — LCOV,
JaCoCo, Cobertura, xccov — auto-detected):

```bash
curl -X POST "https://coverage.example.com/api/v1/upload?repo=acme/app&branch=main&commit=$GITHUB_SHA" \
  -H "Authorization: Bearer $COVALLABY_TOKEN" \
  --data-binary @coverage/lcov.info
```

That's it. The dashboard fills in:

- **`/`** — every repo, latest coverage, trend sparkline
- **`/r/acme/app`** — per-branch history chart, recent uploads
- **`/r/acme/app/u/123`** — one upload: by-directory rollup, per-file table,
  missing line ranges
- **`/badge/acme/app.svg`** — a live badge for your README:
  `![coverage](https://coverage.example.com/badge/acme/app.svg)`

### From a GitHub Actions workflow

```yaml
- name: Upload coverage to Covallaby server
  if: github.ref == 'refs/heads/main'
  run: |
    curl -sf -X POST "$SERVER/api/v1/upload?repo=${{ github.repository }}&branch=${{ github.ref_name }}&commit=${{ github.sha }}" \
      -H "Authorization: Bearer ${{ secrets.COVALLABY_TOKEN }}" \
      --data-binary @coverage/lcov.info
  env:
    SERVER: https://coverage.example.com
```

## Configuration

Everything is optional:

| Env var | Meaning | Default |
|---|---|---|
| `PORT` | Listen port | `8080` |
| `COVALLABY_TOKEN` | Upload token | generated on first boot, printed to log, persisted |
| `COVALLABY_VIEW_TOKEN` | If set, the dashboard needs `?token=…` (or a Bearer header) to view | unset (public) |
| `COVALLABY_DB` | SQLite file path | `data/covallaby.db` |
| `DATABASE_URL` | `postgres://…` — switches storage to Postgres | unset (SQLite) |

## API

| Route | What |
|---|---|
| `POST /api/v1/upload?repo=o/n&branch=&commit=&pr=&format=&strip-prefix=` | raw coverage file as the body; Bearer auth |
| `GET /api/v1/repos` | repos with latest coverage + trend |
| `GET /api/v1/repos/:owner/:name/history?branch=` | upload history |
| `GET /badge/:owner/:name.svg?branch=&label=` | live SVG badge |
| `GET /healthz` | liveness |

## Deploying

- **Fly.io** — `fly launch` detects the Dockerfile. Add a volume for
  `/data` (`fly volumes create covallaby_data`) or attach Fly Postgres and
  set `DATABASE_URL`. The smallest machine is plenty.
- **Any VPS** — `docker compose up -d` behind Caddy/nginx, or run
  `node dist/index.js` under systemd. Back up the single `data/covallaby.db`
  file (or your Postgres).
- **Render / Railway / Coolify** — point them at the Dockerfile; add a disk
  or a Postgres.

## Design

One process, server-rendered HTML, SVG charts generated on the server,
gzip-compressed report blobs, denormalized counters for fast history queries.
Decisions and tradeoffs: [`docs/DESIGN.md`](docs/DESIGN.md).
`src/vendor/` is temporarily copied from the main repo until the packages
publish to npm ([`src/vendor/VENDORED.md`](src/vendor/VENDORED.md)).

## Development

```bash
pnpm install
pnpm verify        # lint + typecheck + build + test
pnpm dev           # run from source with watch
TEST_DATABASE_URL=postgres://… pnpm test   # also run the Postgres store tests
```

## License

MIT
