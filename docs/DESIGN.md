# Design: The Covallaby Server

Status: **Accepted** · v0.1

The optional hosted/self-hosted tier from the Covallaby spec: history,
dashboards, badges. The GitHub Action never requires it — this exists for
teams that want coverage *over time* and live badge URLs.

## Constraints (in priority order)

1. **Easy** — one process, one config value, one data file. `docker run` or
   `node dist/index.js` and you're live.
2. **Cheap anywhere** — runs on a $4 VPS, Fly.io's smallest machine, or a
   Raspberry Pi. No Postgres, no Redis, no object storage, no build farm.
3. **Performant** — server-rendered HTML measured in single-digit
   milliseconds, SQLite reads with proper indexes, gzip-compressed report
   blobs.

## Decisions

**Node 22 + `node:sqlite`.** The built-in SQLite driver means *zero* native
dependencies — no prebuild matrix, no node-gyp, `pnpm install` works on any
architecture Docker or a VPS can offer. Experimental-but-stable-enough
tradeoff accepted for a v0; the storage layer is one file (`src/db.ts`) if we
ever need to swap to better-sqlite3.

**Hono + @hono/node-server.** Tiny, fast, zero-dependency router. If someone
wants to run the API on Bun/Deno/Workers later, Hono is the framework that
ports.

**Server-rendered HTML, no client build.** The dashboard is template strings
+ a design-token stylesheet + server-generated SVG charts. No React, no
bundler, no hydration — pages are fast on a Pi and the repo stays
contribution-friendly. Charts follow the dataviz method: 2px lines, token
inks, hairline grids, dark mode via `prefers-color-scheme`.

**One token, generated for you.** Uploads require `Authorization: Bearer
<token>`. Set `COVALLABY_TOKEN`, or the server generates one on first boot,
persists it in the DB, and prints it to the log. Easy *and* not-open-by-
default. Dashboard viewing is public by default (self-hosters usually sit
behind a VPN/proxy); `COVALLABY_VIEW_TOKEN` optionally gates reads.

**Storage.** SQLite file at `COVALLABY_DB` (default `./data/covallaby.db`).
Uploads store denormalized summary counters (for fast history queries)
plus the full normalized report as a gzipped blob (for the detail view).
A year of hourly uploads for a 5k-file repo is a few hundred MB — fine.

**Vendored parsers.** `src/vendor/` is a copy of `@covallaby/core` +
`@covallaby/parsers` from covallaby/covallaby (imports rewritten), because
the packages aren't on npm yet. The moment they publish, `vendor/` is
deleted for real dependencies. Tracked in VENDORED.md.

## Surface

| Route | What |
|---|---|
| `POST /api/v1/upload?repo=o/n&branch=&commit=&pr=` | raw coverage file body (any supported format), Bearer auth |
| `GET /api/v1/repos` · `GET /api/v1/repos/:owner/:name/history` | JSON mirrors of the pages |
| `GET /` | all repos: latest %, trend sparkline |
| `GET /r/:owner/:name` | branch history chart, recent uploads |
| `GET /r/:owner/:name/u/:id` | one upload: summary, by-directory, files table |
| `GET /badge/:owner/:name.svg` | live badge (the answer to "where does my README badge live?") |
| `GET /healthz` | liveness |

## Non-goals (v0)

GitHub App/webhooks, multi-user auth, orgs/teams, PR-diff patch coverage
server-side (the Action already owns PR context), horizontal scaling.
