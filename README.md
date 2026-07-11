<p align="center">
  <img src="brand/readme-header.png" alt="You write code. We cover it. — Covallaby generates beautiful coverage reports for your pull requests." width="820">
</p>

<p align="center">
  <a href="https://covallaby.com"><b>covallaby.com</b></a> &nbsp;·&nbsp;
  <a href="https://covallaby.com/demo/">Live dashboard demo</a> &nbsp;·&nbsp;
  <a href="https://github.com/covallaby/covallaby/actions/workflows/ci.yml"><img src="https://github.com/covallaby/covallaby/actions/workflows/ci.yml/badge.svg" alt="CI" valign="middle"></a> &nbsp;·&nbsp;
  <a href="https://app.covallaby.com/r/covallaby/covallaby"><img src="https://app.covallaby.com/badge/covallaby/covallaby.svg" alt="coverage" valign="middle"></a>
</p>

**Self-hosted coverage history, dashboards, and live badges — one tiny
process.** The home of Covallaby's platform. Pull requests are covered by the
[Covallaby GitHub Action](https://github.com/covallaby/action) — which never
requires this server; run this when you want coverage *over time*, PR
comparisons, and a badge URL for your README.

- **One process, one file.** Node 22 + built-in SQLite. No Postgres required,
  no Redis, no object storage, no client build. ~50 MB RAM.
- **Postgres when you want it.** Set `DATABASE_URL` and it uses your managed
  Postgres instead — same features, zero code changes.
- **Runs nearly anywhere.** A $4 VPS, Fly.io's smallest machine, a Raspberry
  Pi, `docker run`. Zero native dependencies.

## ☁️ Don't want to run it? Use the hosted version

Covallaby is hosted at **[covallaby.com](https://covallaby.com)** — sign in with
GitHub at **[app.covallaby.com](https://app.covallaby.com)**, point your CI's
coverage upload at it, and get history, dashboards, and badges with nothing to
operate. Repos organize automatically under your GitHub orgs; you only see the
orgs you belong to.

Everything below is for **self-hosting** the exact same server yourself — it's
the identical open-source build. (The hosted tier adds only GitHub sign-in,
per-account scoping, and billing on top.)

## Quick start

```bash
git clone https://github.com/covallaby/covallaby covallaby
cd covallaby
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

### Coverage split across parallel jobs

If your test suite is **sharded across parallel CI jobs** — each producing a
partial coverage file on a different runner — add `&merge=1` to the upload.
Covallaby accumulates every shard into **one** upload for the commit (merging
file and line coverage) instead of last-write-wins:

```yaml
# in each shard job — same commit, &merge=1
- run: |
    curl -sf -X POST "$SERVER/api/v1/upload?repo=${{ github.repository }}&commit=${{ github.sha }}&merge=1" \
      -H "Authorization: Bearer ${{ secrets.COVALLABY_TOKEN }}" \
      --data-binary @coverage/lcov.info
```

Each response says whether it created the upload or merged into an existing one
(`"merged": true`). Without `&merge=1`, every upload is its own snapshot (the
default). If your partials instead all land together in one job, just merge
client-side and upload once — the [CLI](https://github.com/covallaby/action)
and Action take multiple coverage files (newline- or comma-separated) and merge
them for you.

## Configuration

Everything is optional:

| Env var | Meaning | Default |
|---|---|---|
| `PORT` | Listen port | `8080` |
| `COVALLABY_TOKEN` | Upload token | generated on first boot, printed to log, persisted |
| `COVALLABY_VIEW_TOKEN` | If set, the dashboard needs `?token=…` (or a Bearer header) to view | unset (public) |
| `COVALLABY_DB` | SQLite file path | `data/covallaby.db` |
| `DATABASE_URL` | `postgres://…` — switches storage to Postgres | unset (SQLite) |
| `COVALLABY_ARTIFACT_BUCKET` | Private S3-compatible bucket for browser-test videos and traces. `BUCKET_NAME` is also recognized (Fly Tigris default). | unset (local disk) |
| `COVALLABY_ARTIFACTS_DIR` | Local browser-artifact directory when no bucket is configured. Put this on a persistent volume. | `data/artifacts` |
| `AWS_ENDPOINT_URL_S3` / `AWS_REGION` | S3-compatible endpoint and region (Tigris, R2, MinIO, AWS S3). | AWS defaults |
| `COVALLABY_S3_PATH_STYLE` | Set `1` for providers such as MinIO that require path-style bucket URLs. | unset |
| `COVALLABY_ARTIFACT_RETENTION_DAYS` | Days to retain ordinary browser runs and closed-PR runs. | `30` |
| `COVALLABY_KEEP_LATEST_DEFAULT_BRANCH` | Always preserve the latest completed run on the repository default branch. | `true` |
| `COVALLABY_KEEP_LATEST_UNKNOWN_PRS` | Preserve the latest run for PRs whose state is unavailable. | `true` |
| `COVALLABY_HOSTED` | `1` turns on the multi-tenant hosted tier (GitHub sign-in + per-account scoping). Requires the GitHub OAuth + session env below. | unset (single-tenant) |

## API

| Route | What |
|---|---|
| `POST /api/v1/upload?repo=o/n&branch=&commit=&pr=&format=&strip-prefix=&merge=1` | raw coverage file as the body; Bearer auth. `merge=1` accumulates sharded uploads into one per commit |
| `GET /api/v1/repos` | repos with latest coverage + trend |
| `GET /api/v1/repos/:owner/:name/history?branch=` | upload history |
| `GET /api/v1/repos/:owner/:name/prs` | PRs with uploads, latest first |
| `GET /api/v1/repos/:owner/:name/compare?pr=N` or `?head=<branch>` (+`&base=`) | head vs base: delta + per-file changes |
| `POST /api/v1/repos/:owner/:name/token` | mint/rotate a per-repo upload token (admin token required) |
| `POST /api/v1/test-runs` · `POST /api/v1/test-runs/:id/complete` | create and finalize a browser-test run; returns direct upload URLs |
| `GET /api/v1/repos/:owner/:name/test-runs` | recent Playwright runs and playback status |
| `GET /badge/:owner/:name.svg?branch=&label=` | live SVG badge |
| `GET /healthz` | liveness |

## Pull requests & branch compare

Upload with `&pr=123` from PR CI (use the PR's branch) and the dashboard
grows a Pull requests rail; each PR page compares its latest upload against
the base branch (`?base=`, default `main`) with per-file changes. The
Compare page does the same for any two branches. This is the project-level
story — line-level *patch* coverage stays in the GitHub Action's PR comment,
where the diff lives.

## Security

- Uploads require a bearer token: the admin token (`COVALLABY_TOKEN`, or
  generated + persisted on first boot) or a **per-repo token** minted via
  `POST /api/v1/repos/:owner/:name/token` (admin-authed). Repo tokens can
  only write their own repo — hand those to CI, keep the admin token out of it.
- Uploads are **rate limited** (30/minute per token; `uploadsPerMinute` in
  code) and capped at 50 MB.
- The server never clones or reads your repositories — it only ever sees the
  coverage files CI posts: file paths, line numbers, hit counts. No source
  code, no git credentials.
- Set `COVALLABY_VIEW_TOKEN` to gate the dashboard; terminate TLS with your
  reverse proxy.
- Browser artifacts never live in Postgres. Buckets must remain private;
  Covallaby uses 15-minute upload URLs and one-hour playback URLs.

## Playwright recordings and traces

The Covallaby Action can attach Playwright's JSON reporter, videos,
screenshots, and traces to the same repository dashboard:

```ts
// playwright.config.ts
export default defineConfig({
  reporter: [["json", { outputFile: "playwright-results.json" }], ["html"]],
  use: { video: "on", trace: "retain-on-failure", screenshot: "only-on-failure" },
});
```

```yaml
- uses: covallaby/action@main
  with:
    files: coverage/lcov.info
    server-url: https://app.covallaby.com
    server-token: ${{ secrets.COVALLABY_TOKEN }}
    playwright-results: playwright-results.json
    playwright-artifacts: test-results
```

Self-hosters get the same feature with local disk by default. For production,
configure any private S3-compatible bucket; CI uploads large files directly to
the bucket, so they do not pass through the Covallaby process.

### Artifact retention

Ordinary browser runs are retained for 30 days by default. The latest completed
run on the repository default branch is always preserved. Hosted installations
with `GITHUB_WEBHOOK_SECRET` also preserve the latest run for every open PR;
when a PR closes, its latest run receives a fresh 30-day grace period. Configure
the GitHub App webhook URL as `/api/v1/github/webhook` and subscribe to **Pull
request** events. Signatures are verified before retention state is recorded.

Unknown PRs are treated as open so a missed webhook cannot erase useful
evidence. Self-hosters without GitHub can keep that safe default or set
`COVALLABY_KEEP_LATEST_UNKNOWN_PRS=false` for strict time-based cleanup.
Cleanup runs after successful browser-run uploads; object storage and database
metadata are removed together.

## Hosted / multi-tenant mode (optional)

The same binary runs a multi-tenant hosted product when `COVALLABY_HOSTED=1`.
It adds **Sign in with GitHub** and scopes every read to the accounts GitHub
says you can see — authorization is deferred to GitHub, never our own ACLs.
Uploads stay token-authed and unchanged. Leave `COVALLABY_HOSTED` unset and
you get the plain single-tenant server; none of this mounts.

Required in hosted mode:

| Env var | Meaning |
|---|---|
| `COVALLABY_BASE_URL` | Public base URL (for OAuth redirect + Stripe return) |
| `COVALLABY_SESSION_SECRET` | Random secret signing session cookies |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | A GitHub OAuth app |
| `GITHUB_API_BASE` | Optional — a GHES API base for self-hosted GitHub |
| `GITHUB_WEBHOOK_SECRET` | Optional GitHub App webhook secret; enables GitHub-aware artifact retention. |

Billing is optional even in hosted mode — set the Stripe env to enable the Pro
plan, omit it and everything is `free`:

| Env var | Meaning |
|---|---|
| `STRIPE_SECRET_KEY` · `STRIPE_WEBHOOK_SECRET` · `STRIPE_PRICE_ID` | Stripe subscription billing |

Design: [`docs/HOSTED.md`](docs/HOSTED.md).

## Deploying

One process, one `Dockerfile`, runs anywhere. Ready-made templates and buttons:

<p>
  <a href="https://render.com/deploy?repo=https://github.com/covallaby/covallaby"><img src="https://render.com/images/deploy-to-render-button.svg" alt="Deploy to Render" height="32"></a>
  &nbsp;
  <a href="https://heroku.com/deploy?template=https://github.com/covallaby/covallaby"><img src="https://www.herokucdn.com/deploy/button.svg" alt="Deploy to Heroku" height="32"></a>
  &nbsp;
  <a href="https://railway.app/new/template?template=https://github.com/covallaby/covallaby"><img src="https://railway.app/button.svg" alt="Deploy on Railway" height="32"></a>
  &nbsp;
  <a href="https://app.koyeb.com/deploy?type=git&repository=github.com/covallaby/covallaby&ports=8080;http;/"><img src="https://www.koyeb.com/static/images/deploy/button.svg" alt="Deploy to Koyeb" height="32"></a>
  &nbsp;
  <a href="https://cloud.digitalocean.com/apps/new?repo=https://github.com/covallaby/covallaby/tree/main"><img src="https://www.deploytodo.com/do-btn-blue.svg" alt="Deploy to DigitalOcean" height="32"></a>
</p>

- **Fly.io** — `fly launch` (or use [`deploy/fly.toml`](deploy/fly.toml)). Add a
  volume for `/data` (`fly volumes create covallaby_data`) or attach Fly Postgres.
- **Render / Heroku** — the buttons above. Render provisions a persistent disk
  for SQLite ([`deploy/render.yaml`](deploy/render.yaml)); Heroku attaches a
  Postgres addon and sets `DATABASE_URL` for you ([`app.json`](app.json)).
- **Railway / Koyeb / DigitalOcean** — the buttons above; templates in
  [`deploy/`](deploy/). These have ephemeral filesystems, so use `DATABASE_URL`.
- **Any VPS / Docker host** — `docker compose up -d` behind Caddy/nginx, or
  `node dist/index.js` under systemd. Back up the single `data/covallaby.db`
  (or your Postgres).

- **Cloudflare Workers** — runs on **D1** (edge SQLite) via
  [`wrangler.toml`](wrangler.toml): `wrangler d1 create covallaby`, `pnpm build`,
  `wrangler deploy`. Scales to zero on the free tier.

Storage in one line: **SQLite needs a persistent volume at `/data`; Postgres
(`DATABASE_URL`) needs none; Cloudflare uses D1.** Full guide in
[`deploy/`](deploy/README.md).

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

**AGPL-3.0-only.** You can run, self-host, modify, and study the whole server
freely — the one obligation is that if you offer a *modified* version to others
over a network, you share your changes. Using Covallaby (uploading coverage,
running the Action) never touches your own code's license.

The [GitHub Action, CLI, parsers, and coverage core](https://github.com/covallaby/action)
stay **MIT** — the tools everyone installs carry no copyleft. This server
vendors that MIT core (see [`src/vendor/`](src/vendor/)); combining MIT into an
AGPL work is permitted and keeps the vendored files under their original MIT terms.

---

<sub>Created by [Josh Holtz](https://github.com/joshdholtz) · [Mostly Good LLC](https://mostlygood.dev) · AGPL-3.0</sub>
