# Design: The Hosted Tier

Status: **In progress** · builds on the self-hosted server

The optional paid tier the spec always pointed at ("It later grows into an
optional hosted service… never required"). The rule that keeps it from
overcomplicating anything:

> **One engine. The hosted tier is additive middleware around the same core,
> gated off by default. A self-hoster who sets no hosted env vars runs the
> exact single-tenant server as before.**

The coverage engine (parsers, `Store`, summaries, patch/diff math) is already
tenant-agnostic — every upload is keyed by `repo` = `owner/name`, and `owner`
*is* the tenant boundary. So the hosted tier never touches the engine; it adds
an edge: identity, tenancy, billing.

## Mode gating

`COVALLABY_HOSTED=1` turns the tier on. It requires the OAuth + Stripe env
(below); missing config fails fast at boot with a clear message. When unset,
none of the hosted routes or middleware mount — behaviour is byte-identical to
the self-hosted server, and its 25 tests still pass.

## Accounts & tenancy

- An **account** is a GitHub owner (org or user login). It's stored on each
  upload (`account` column, auto-derived from `repo` = `owner/name`). Nullable
  and defaulted so self-hosted rows are unaffected.
- **Authorization is deferred to GitHub.** A signed-in user may view a repo's
  coverage iff GitHub says they can access that repo. We never build
  permissions/teams — we read the user's accessible orgs/repos from GitHub at
  login and scope reads to those accounts. No per-resource ACLs of our own.
- Reads in hosted mode are always scoped: `WHERE account = ANY($accounts)`.

## Identity: Sign in with GitHub (OAuth)

Standard web flow, no passwords:

1. `GET /auth/github/login` → redirect to GitHub authorize (scope: `read:org`,
   `repo` read for private-repo visibility) with a signed `state`.
2. `GET /auth/github/callback` → exchange code for a user token, fetch the
   viewer + their orgs, create a **session** (signed, HttpOnly cookie), store
   the accessible account set.
3. `POST /auth/logout` clears it.

The GitHub client is an interface (`GitHubClient`) so tests inject a fake; live
uses `fetch` against api.github.com (or a GHES base URL).

## Upload auth (unchanged)

CI still uploads with a **per-repo token** — the mechanism the self-hosted
server already has. In hosted mode a token is minted when a repo is connected
and is bound to that repo's account. The upload path is unchanged.

## Billing: Stripe

The one genuinely new subsystem, deliberately isolated — nothing else in the
system knows about money.

- A `subscriptions` table: `account`, `plan` (`free`|`pro`), `status`,
  `stripe_customer`, `current_period_end`.
- **Free** — public repos, capped history retention.
- **Pro** — private repos, full retention, team access.
- A `Billing` layer with a `planFor(account)` check. A middleware enforces:
  private-repo uploads and reads require an active `pro` plan; free accounts
  hit a friendly 402 with an upgrade link.
- `POST /billing/checkout` creates a Stripe Checkout session; `POST
  /billing/webhook` (Stripe-signature-verified) updates subscription status.
- The Stripe client is an interface (`BillingClient`) so tests use a fake;
  live uses the `stripe` SDK. No Stripe env → billing disabled (everything is
  effectively `free`), so the tier degrades safely.

## What stays out

Still no orgs/teams/roles of our own (GitHub owns that), no seat management in
v1 (per-account plan), no enterprise SSO. The self-hosted server keeps zero of
this.

## Sequencing

1. `account` column + read scoping (forward-compat; safe for self-hosted). ✅
2. Hosted config + mode gating.
3. GitHub OAuth + sessions + tenancy scoping.
4. Stripe billing gate.
5. Later: connect-a-repo UI, retention enforcement, marketing/pricing on
   covallaby.com.
