import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import type { ArtifactStorage } from "../src/artifacts.js";
import { type HostedConfig, loadHostedConfig } from "../src/hosted/config.js";
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

const upsertPullRequestComment = vi.fn(async () => {});
const createCommitStatus = vi.fn(async () => {});
const fakeGitHubApp: GitHubAppClient = {
  getInstallation: async (id) => ({ id, account: id === 999 ? "other" : "acme" }),
  listRepositories: async () => [{ fullName: "acme/app", defaultBranch: "main" }],
  listOpenPullRequests: async () => [7],
  upsertPullRequestComment,
  createCommitStatus,
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

describe("hosted configuration", () => {
  const base = {
    COVALLABY_HOSTED: "1",
    COVALLABY_SESSION_SECRET: "session",
    GITHUB_CLIENT_ID: "client",
    GITHUB_CLIENT_SECRET: "oauth-secret",
  };

  it("rejects a GitHub App without a webhook secret", () => {
    expect(() =>
      loadHostedConfig({
        ...base,
        GITHUB_APP_ID: "123",
        GITHUB_APP_SLUG: "covallaby-cloud",
        GITHUB_APP_PRIVATE_KEY: "private-key",
      }),
    ).toThrow("GITHUB_WEBHOOK_SECRET");
  });

  it("loads a complete GitHub App configuration", () => {
    expect(
      loadHostedConfig({
        ...base,
        GITHUB_APP_ID: "123",
        GITHUB_APP_SLUG: "covallaby-cloud",
        GITHUB_APP_PRIVATE_KEY: "private-key",
        GITHUB_WEBHOOK_SECRET: "webhook-secret",
      })?.githubApp?.appId,
    ).toBe("123");
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

  it("matches GitHub account names case-insensitively", async () => {
    const res = await app.request("/api/v1/repos/acme/app/test-runs", {
      headers: { cookie: session(["ACME"]) },
    });
    expect(res.status).toBe(200);
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

  it("owns the sticky PR comment only when its GitHub App is installed", async () => {
    await store.setMeta("github-app:account:acme", "123");
    const body = "<!-- covallaby-report:v1 -->\n\n## Covallaby";
    const handled = await app.request("/api/v1/github/pr-comment", {
      method: "POST",
      headers: { authorization: "Bearer up", "content-type": "application/json" },
      body: JSON.stringify({
        repo: "acme/app",
        pr: 7,
        marker: "<!-- covallaby-report:v1 -->",
        body,
      }),
    });
    expect(await handled.json()).toMatchObject({ ok: true, handled: true });
    expect(upsertPullRequestComment).toHaveBeenCalledWith(
      123,
      "acme/app",
      7,
      "<!-- covallaby-report:v1 -->",
      body,
    );

    const fallback = await app.request("/api/v1/github/pr-comment", {
      method: "POST",
      headers: { authorization: "Bearer up", "content-type": "application/json" },
      body: JSON.stringify({
        repo: "alice/app",
        pr: 8,
        marker: "<!-- covallaby-report:v1 -->",
        body,
      }),
    });
    expect(await fallback.json()).toMatchObject({ ok: true, handled: false });
  });
});

describe("hosted review auth", () => {
  it("accepts reviews from a session covering the repo owner and rejects others", async () => {
    const store = new SqliteStore(":memory:");
    const storage: ArtifactStorage = {
      kind: "local",
      createUploadUrl: async () => null,
      createDownloadUrl: async () => null,
      put: async () => {},
      get: async () => new Uint8Array(),
      exists: async () => true,
      delete: async () => {},
    };
    const app = createApp({
      store,
      uploadToken: "up",
      hosted: config,
      hostedDeps: { github: fakeGitHub },
      artifactStorage: storage,
      storybookPreviewBaseUrl: "https://previews.test",
      storybookPreviewSecret: "preview-secret",
    });
    // A mainline baseline (auto-accepted) and a feature run with one new story.
    const zeros = {
      pr: null,
      framework: "storybook",
      testsPassed: 0,
      testsFailed: 0,
      testsSkipped: 0,
      durationMs: 0,
    };
    const base = await store.createTestRun({
      repo: "acme/app",
      branch: "main",
      commit: "m1",
      ...zeros,
      reviewState: "auto-accepted",
    });
    await store.completeTestRun(base.id);
    const run = await store.createTestRun({
      repo: "acme/app",
      branch: "feat/x",
      commit: "f1",
      ...zeros,
      pr: 1,
    });
    await store.createTestArtifact({
      runId: run.id,
      name: "_covallaby/captures/button--a.png",
      kind: "screenshot",
      contentType: "image/png",
      sizeBytes: 4,
      objectKey: `k-${run.id}`,
      testName: JSON.stringify({
        id: "button--a",
        title: "Components/Button",
        name: "a",
        sha256: "e".repeat(64),
      }),
    });
    await store.completeTestRun(run.id);

    const review = (cookie?: string) =>
      app.request(`/api/v1/storybook-previews/${run.id}/review-captures`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
        body: JSON.stringify({ stories: ["button--a"], state: "approved" }),
      });
    expect((await review()).status).toBe(401); // hosted mode: no session, no review
    expect((await review(sessionCookieFor(["bob"]))).status).toBe(401); // wrong account
    const ok = await review(sessionCookieFor(["acme"]));
    expect(ok.status).toBe(200);
    const json = await ok.json();
    expect(json.run.reviewState).toBe("approved");
    // The verdict records who reviewed it — the session login.
    expect(
      json.captures.find((capture: { id: string }) => capture.id === "button--a").review,
    ).toMatchObject({ state: "approved", reviewedBy: "alice" });
  });
});

describe("per-signal covallaby/components status (hosted GitHub App)", () => {
  class MemoryArtifacts implements ArtifactStorage {
    readonly kind = "local" as const;
    objects = new Map<string, Uint8Array>();
    async createUploadUrl() {
      return null;
    }
    async createDownloadUrl() {
      return null;
    }
    async put(key: string, body: Uint8Array) {
      this.objects.set(key, body);
    }
    async get(key: string) {
      return this.objects.get(key)!;
    }
    async exists(key: string, size: number) {
      return this.objects.get(key)?.byteLength === size;
    }
    async delete(key: string) {
      this.objects.delete(key);
    }
  }

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
    artifactStorage: new MemoryArtifacts(),
    storybookPreviewBaseUrl: "https://previews.test",
    storybookPreviewSecret: "preview-secret",
  });
  const auth = { authorization: "Bearer up", "content-type": "application/json" };

  /** Upload + complete a one-file Storybook preview; returns the run id. */
  const publishPreview = async (repo: string, commit: string): Promise<number> => {
    const created = await app.request("/api/v1/storybook-previews", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        repo,
        branch: "feature/x",
        commit,
        pr: 7,
        files: [{ path: "index.html", contentType: "text/html", sizeBytes: 4 }],
      }),
    });
    expect(created.status).toBe(201);
    const data = await created.json();
    const uploaded = await app.request(new URL(data.artifacts[0].uploadUrl).pathname, {
      method: "PUT",
      headers: { authorization: "Bearer up", "content-type": "text/html" },
      body: "<ok>",
    });
    expect(uploaded.status).toBe(200);
    const completed = await app.request(`/api/v1/storybook-previews/${data.run.id}/complete`, {
      method: "POST",
      headers: { authorization: "Bearer up" },
    });
    expect(completed.status).toBe(200);
    return data.run.id as number;
  };

  it("opens a pending status on completion and settles it on the review verdict", async () => {
    await store.setMeta("github-app:account:acme", "123");
    createCommitStatus.mockClear();

    const id = await publishPreview("acme/app", "abc1234def");
    expect(createCommitStatus).toHaveBeenCalledWith(123, "acme/app", "abc1234def", {
      context: "covallaby/components",
      state: "pending",
      description: "Component captures await visual review.",
      targetUrl: `http://localhost:8080/r/acme/app/storybook-previews/${id}`,
    });

    const review = (state: string) =>
      app.request(`/api/v1/storybook-previews/${id}/review`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ state }),
      });

    createCommitStatus.mockClear();
    expect((await review("rejected")).status).toBe(200);
    expect(createCommitStatus).toHaveBeenCalledWith(
      123,
      "acme/app",
      "abc1234def",
      expect.objectContaining({ context: "covallaby/components", state: "failure" }),
    );

    createCommitStatus.mockClear();
    expect((await review("approved")).status).toBe(200);
    expect(createCommitStatus).toHaveBeenCalledWith(
      123,
      "acme/app",
      "abc1234def",
      expect.objectContaining({ state: "success" }),
    );
  });

  it("skips accounts without an installation and runs without a real SHA", async () => {
    createCommitStatus.mockClear();
    await publishPreview("bob/secret", "abc1234def"); // bob never installed the App
    await publishPreview("acme/app", "unknown"); // no usable commit SHA
    expect(createCommitStatus).not.toHaveBeenCalled();
  });

  it("records the verdict even when GitHub is down", async () => {
    createCommitStatus.mockRejectedValueOnce(new Error("GitHub App /statuses → 502"));
    const id = await publishPreview("acme/app", "feed42feed");
    const res = await app.request(`/api/v1/storybook-previews/${id}/review`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ state: "rejected" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).run.reviewState).toBe("rejected");
  });

  it("updates the status when per-story verdicts change the run's derived review state", async () => {
    await store.setMeta("github-app:account:acme", "123");
    const zeros = {
      pr: 7,
      framework: "storybook",
      testsPassed: 0,
      testsFailed: 0,
      testsSkipped: 0,
      durationMs: 0,
    };
    // A mainline baseline so the feature story lands as reviewable ("new").
    const base = await store.createTestRun({
      repo: "acme/app",
      branch: "main",
      commit: "aaaa1111bbbb",
      ...zeros,
      pr: null,
      reviewState: "auto-accepted",
    });
    await store.completeTestRun(base.id);
    const run = await store.createTestRun({
      repo: "acme/app",
      branch: "feature/x",
      commit: "beef1234cafe",
      ...zeros,
    });
    await store.createTestArtifact({
      runId: run.id,
      name: "_covallaby/captures/button--a.png",
      kind: "screenshot",
      contentType: "image/png",
      sizeBytes: 4,
      objectKey: `k-${run.id}`,
      testName: JSON.stringify({
        id: "button--a",
        title: "Components/Button",
        name: "a",
        sha256: "e".repeat(64),
      }),
    });
    await store.completeTestRun(run.id);

    const reviewCaptures = (state: string) =>
      app.request(`/api/v1/storybook-previews/${run.id}/review-captures`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ stories: ["button--a"], state }),
      });

    // Approving the only reviewable story flips the run to approved → success.
    createCommitStatus.mockClear();
    const approved = await reviewCaptures("approved");
    expect(approved.status).toBe(200);
    expect((await approved.json()).run.reviewState).toBe("approved");
    expect(createCommitStatus).toHaveBeenCalledWith(
      123,
      "acme/app",
      "beef1234cafe",
      expect.objectContaining({ context: "covallaby/components", state: "success" }),
    );

    // A verdict that doesn't change the derived run state posts nothing.
    createCommitStatus.mockClear();
    expect((await reviewCaptures("approved")).status).toBe(200);
    expect(createCommitStatus).not.toHaveBeenCalled();

    // Rejecting flips it back → failure.
    createCommitStatus.mockClear();
    const rejected = await reviewCaptures("rejected");
    expect(rejected.status).toBe(200);
    expect((await rejected.json()).run.reviewState).toBe("rejected");
    expect(createCommitStatus).toHaveBeenCalledWith(
      123,
      "acme/app",
      "beef1234cafe",
      expect.objectContaining({ context: "covallaby/components", state: "failure" }),
    );
  });
});
