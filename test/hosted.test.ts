import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { HostedConfig } from "../src/hosted/config.js";
import type { GitHubAppClient } from "../src/hosted/github-app.js";
import type { GitHubClient } from "../src/hosted/github.js";
import { decodeSession, encodeSession } from "../src/hosted/session.js";
import { SqliteStore } from "../src/store/sqlite.js";

const lcov = "SF:src/a.ts\nDA:1,1\nDA:2,0\nend_of_record\n";

const config: HostedConfig = {
  baseUrl: "http://localhost:8080",
  sessionSecret: "test-secret",
  github: { clientId: "id", clientSecret: "sec", apiBase: "https://api.github.com" },
};

// A fake GitHub that signs in "alice" with access to accounts alice + acme.
const fakeGitHub: GitHubClient = {
  exchangeCode: async () => "user-token",
  getUser: async () => ({ login: "alice", name: "Alice" }),
  getAccounts: async () => ["alice", "acme"],
};

const fakeGitHubApp: GitHubAppClient = {
  getInstallation: async (id) => ({ id, account: id === 999 ? "other" : "acme" }),
  listRepositories: async () => [{ fullName: "acme/app", defaultBranch: "main" }],
  listOpenPullRequests: async () => [7],
};

const sessionCookieFor = (accounts: string[], secret = config.sessionSecret) =>
  `covallaby_session=${encodeSession({ login: "alice", name: "Alice", accounts, iat: Date.now() }, secret)}`;

describe("sessions", () => {
  it("round-trips a signed session and rejects tampering", () => {
    const token = encodeSession(
      { login: "alice", name: "Alice", accounts: ["alice"], iat: Date.now() },
      "s",
    );
    expect(decodeSession(token, "s")?.login).toBe("alice");
    expect(decodeSession(token, "different-secret")).toBeNull();
    expect(decodeSession(`${token}x`, "s")).toBeNull();
  });

  it("expires old sessions", () => {
    const old = encodeSession(
      { login: "a", name: null, accounts: [], iat: Date.now() - 40 * 24 * 3600 * 1000 },
      "s",
    );
    expect(decodeSession(old, "s")).toBeNull();
  });
});

describe("hosted mode: auth + tenancy scoping", () => {
  const store = new SqliteStore(":memory:");
  const app = createApp({
    store,
    uploadToken: "up",
    hosted: config,
    hostedDeps: { github: fakeGitHub },
  });

  const upload = (repo: string, commit: string) =>
    app.request(`/api/v1/upload?repo=${repo}&branch=main&commit=${commit}`, {
      method: "POST",
      headers: { authorization: "Bearer up" },
      body: lcov,
    });

  const session = (accounts: string[]) => sessionCookieFor(accounts);

  it("uploads stay token-authed (no session needed) and record the account", async () => {
    expect((await upload("acme/app", "c1")).status).toBe(200);
    expect((await upload("bob/secret", "c2")).status).toBe(200);
  });

  it("browsing requires a session", async () => {
    expect((await app.request("/api/v1/repos")).status).toBe(401);
  });

  it("scopes /repos to the signed-in user's accounts", async () => {
    const res = await app.request("/api/v1/repos", { headers: { cookie: session(["acme"]) } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.repos.every((r: { repo: string }) => r.repo.startsWith("acme/"))).toBe(true);
    expect(json.repos.some((r: { repo: string }) => r.repo === "bob/secret")).toBe(false);
  });

  it("404s a repo the user can't access", async () => {
    const mine = await app.request("/api/v1/repos/acme/app/history", {
      headers: { cookie: session(["acme"]) },
    });
    expect(mine.status).toBe(200);
    const notMine = await app.request("/api/v1/repos/bob/secret/history", {
      headers: { cookie: session(["acme"]) },
    });
    expect(notMine.status).toBe(404);
  });

  it("reports the signed-in user at /api/v1/me", async () => {
    const res = await app.request("/api/v1/me", {
      headers: { cookie: session(["alice", "acme"]) },
    });
    const json = await res.json();
    expect(json.authenticated).toBe(true);
    expect(json.accounts).toEqual(["alice", "acme"]);
  });
});

describe("self-hosted mode is unaffected", () => {
  it("serves /repos with no session when hosted is off", async () => {
    const store = new SqliteStore(":memory:");
    const app = createApp({ store, uploadToken: "up" });
    await app.request("/api/v1/upload?repo=x/y&branch=main&commit=c", {
      method: "POST",
      headers: { authorization: "Bearer up" },
      body: lcov,
    });
    expect((await app.request("/api/v1/repos")).status).toBe(200);
  });
});

describe("GitHub App retention webhooks", () => {
  const store = new SqliteStore(":memory:");
  const webhookConfig: HostedConfig = {
    ...config,
    github: { ...config.github, webhookSecret: "hook-secret" },
  };
  const app = createApp({
    store,
    uploadToken: "up",
    hosted: webhookConfig,
    hostedDeps: { github: fakeGitHub },
  });
  const payload = JSON.stringify({
    action: "closed",
    number: 42,
    pull_request: { closed_at: "2026-07-01T00:00:00Z" },
    repository: { full_name: "acme/app", default_branch: "trunk" },
  });
  const signature = `sha256=${createHmac("sha256", "hook-secret").update(payload).digest("hex")}`;

  it("rejects unsigned events and records signed PR/default-branch state", async () => {
    expect(
      (await app.request("/api/v1/github/webhook", { method: "POST", body: payload })).status,
    ).toBe(401);
    const accepted = await app.request("/api/v1/github/webhook", {
      method: "POST",
      headers: {
        "x-github-event": "pull_request",
        "x-hub-signature-256": signature,
      },
      body: payload,
    });
    expect(accepted.status).toBe(200);
    expect(await store.getMeta("artifact-retention:repo:acme/app")).toContain(
      '"defaultBranch":"trunk"',
    );
    expect(await store.getMeta("artifact-retention:pr:acme/app:42")).toContain('"open":false');
  });

  it("records and removes installations only for installation events", async () => {
    const send = async (action: string, event: string) => {
      const body = JSON.stringify({
        action,
        installation: { id: 123, account: { login: "acme" } },
      });
      return app.request("/api/v1/github/webhook", {
        method: "POST",
        headers: {
          "x-github-event": event,
          "x-hub-signature-256": `sha256=${createHmac("sha256", "hook-secret").update(body).digest("hex")}`,
        },
        body,
      });
    };

    expect((await send("created", "installation")).status).toBe(200);
    expect(await store.getMeta("github-app:account:acme")).toBe("123");

    // A similarly named action on another event must not uninstall the App.
    expect((await send("deleted", "repository")).status).toBe(200);
    expect(await store.getMeta("github-app:account:acme")).toBe("123");

    expect((await send("deleted", "installation")).status).toBe(200);
    expect(await store.getMeta("github-app:account:acme")).toBe("");
  });
});

describe("GitHub App installation flow", () => {
  const store = new SqliteStore(":memory:");
  const appConfig: HostedConfig = {
    ...config,
    githubApp: {
      appId: "123",
      slug: "covallaby-cloud",
      privateKey: "injected-in-tests",
      bootstrapInstallationIds: [],
    },
  };
  const app = createApp({
    store,
    uploadToken: "up",
    hosted: appConfig,
    hostedDeps: { github: fakeGitHub, githubApp: fakeGitHubApp },
  });

  it("reports installation status and redirects to the public installation flow", async () => {
    const before = await app.request("/api/v1/github/status", {
      headers: { cookie: sessionCookieFor(["acme"]) },
    });
    expect((await before.json()).accounts).toEqual([{ account: "acme", installed: false }]);
    const install = await app.request("/api/v1/github/install", {
      headers: { cookie: sessionCookieFor(["acme"]) },
    });
    expect(install.headers.get("location")).toBe(
      "https://github.com/apps/covallaby-cloud/installations/new",
    );
  });

  it("records an installation only for a GitHub account in the signed-in session", async () => {
    const denied = await app.request("/api/v1/github/setup?installation_id=999", {
      headers: { cookie: sessionCookieFor(["acme"]) },
    });
    expect(denied.status).toBe(403);

    const setup = await app.request("/api/v1/github/setup?installation_id=123", {
      headers: { cookie: sessionCookieFor(["acme"]) },
    });
    expect(setup.status).toBe(302);
    expect(await store.getMeta("github-app:account:acme")).toBe("123");
    const after = await app.request("/api/v1/github/status", {
      headers: { cookie: sessionCookieFor(["acme"]) },
    });
    expect((await after.json()).accounts[0].installed).toBe(true);
  });
});
