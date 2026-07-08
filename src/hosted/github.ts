import type { HostedConfig } from "./config.js";

export interface GitHubUser {
  login: string;
  name: string | null;
}

/**
 * The slice of GitHub we need for sign-in and tenancy. An interface so tests
 * inject a fake; the live impl calls the REST API (api.github.com or a GHES
 * base). We read the user + their org memberships and treat those as the
 * accounts they may view — authorization deferred to GitHub, never our own ACLs.
 */
export interface GitHubClient {
  exchangeCode(code: string): Promise<string>; // → user access token
  getUser(token: string): Promise<GitHubUser>;
  getAccounts(token: string): Promise<string[]>; // owner logins (self + orgs)
}

export function createGitHubClient(config: HostedConfig): GitHubClient {
  const { clientId, clientSecret, apiBase } = config.github;

  async function api<T>(path: string, token: string): Promise<T> {
    const res = await fetch(`${apiBase}${path}`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "user-agent": "covallaby",
      },
    });
    if (!res.ok) throw new Error(`GitHub ${path} → ${res.status}`);
    return (await res.json()) as T;
  }

  return {
    async exchangeCode(code) {
      const res = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
      });
      const data = (await res.json()) as { access_token?: string; error?: string };
      if (!data.access_token) throw new Error(`OAuth exchange failed: ${data.error ?? res.status}`);
      return data.access_token;
    },

    async getUser(token) {
      const u = await api<{ login: string; name: string | null }>("/user", token);
      return { login: u.login, name: u.name };
    },

    async getAccounts(token) {
      const user = await api<{ login: string }>("/user", token);
      const orgs = await api<Array<{ login: string }>>("/user/orgs", token);
      return [user.login, ...orgs.map((o) => o.login)];
    },
  };
}

export const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
