import { createSign } from "node:crypto";
import { prRetentionKey, recordPRRetentionState, recordRepoRetentionState } from "../retention.js";
import type { Store } from "../store.js";

export interface GitHubInstallation {
  id: number;
  account: string;
}

export interface GitHubInstallationRepo {
  fullName: string;
  defaultBranch: string;
}

export interface GitHubAppClient {
  getInstallation(id: number): Promise<GitHubInstallation>;
  listRepositories(id: number): Promise<GitHubInstallationRepo[]>;
  listOpenPullRequests(id: number, repo: string): Promise<number[]>;
}

export const installationAccountKey = (account: string): string =>
  `github-app:account:${account.toLowerCase()}`;
export const installationIdKey = (id: number): string => `github-app:installation:${id}`;

export async function recordInstallation(
  store: Store,
  installation: GitHubInstallation,
): Promise<void> {
  await Promise.all([
    store.setMeta(installationAccountKey(installation.account), String(installation.id)),
    store.setMeta(installationIdKey(installation.id), installation.account),
  ]);
}

export async function clearInstallation(store: Store, installation: GitHubInstallation) {
  await Promise.all([
    store.setMeta(installationAccountKey(installation.account), ""),
    store.setMeta(installationIdKey(installation.id), ""),
  ]);
}

export async function reconcileInstallation(
  store: Store,
  github: GitHubAppClient,
  installationId: number,
): Promise<void> {
  const repos = await github.listRepositories(installationId);
  for (const repo of repos) {
    await recordRepoRetentionState(store, repo.fullName, repo.defaultBranch);
    if (!store.listTestRuns) continue;
    const runs = await store.listTestRuns(repo.fullName, 10_000);
    const prs = [...new Set(runs.flatMap((run) => (run.pr === null ? [] : [run.pr])))];
    if (prs.length === 0) continue;
    const open = new Set(await github.listOpenPullRequests(installationId, repo.fullName));
    for (const pr of prs) {
      const isOpen = open.has(pr);
      const existing = await store.getMeta(prRetentionKey(repo.fullName, pr));
      let closedAt = isOpen ? null : new Date().toISOString();
      if (!isOpen && existing) {
        try {
          const parsed = JSON.parse(existing) as { open?: boolean; closedAt?: string | null };
          if (parsed.open === false && parsed.closedAt) closedAt = parsed.closedAt;
        } catch {
          // Replace malformed metadata with a valid state below.
        }
      }
      await recordPRRetentionState(store, repo.fullName, pr, isOpen, closedAt);
    }
  }
}

const base64url = (value: string): string => Buffer.from(value).toString("base64url");

export function createGitHubAppClient(config: {
  appId: string;
  privateKey: string;
  apiBase: string;
}): GitHubAppClient {
  const appToken = (): string => {
    const now = Math.floor(Date.now() / 1000);
    const unsigned = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: config.appId }))}`;
    const signature = createSign("RSA-SHA256")
      .update(unsigned)
      .sign(config.privateKey, "base64url");
    return `${unsigned}.${signature}`;
  };

  const api = async <T>(path: string, token: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`${config.apiBase}${path}`, {
      ...init,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "user-agent": "covallaby",
        ...init?.headers,
      },
    });
    if (!response.ok) throw new Error(`GitHub App ${path} → ${response.status}`);
    return (await response.json()) as T;
  };

  const installationToken = async (id: number): Promise<string> => {
    const data = await api<{ token: string }>(
      `/app/installations/${id}/access_tokens`,
      appToken(),
      { method: "POST" },
    );
    return data.token;
  };

  const paged = async <T>(path: string, token: string): Promise<T[]> => {
    const items: T[] = [];
    for (let page = 1; ; page++) {
      const separator = path.includes("?") ? "&" : "?";
      const batch = await api<T[]>(`${path}${separator}per_page=100&page=${page}`, token);
      items.push(...batch);
      if (batch.length < 100) return items;
    }
  };

  return {
    async getInstallation(id) {
      const data = await api<{ id: number; account: { login: string } }>(
        `/app/installations/${id}`,
        appToken(),
      );
      return { id: data.id, account: data.account.login };
    },
    async listRepositories(id) {
      const token = await installationToken(id);
      const repositories: Array<{ full_name: string; default_branch: string }> = [];
      for (let page = 1; ; page++) {
        const data = await api<{
          repositories: Array<{ full_name: string; default_branch: string }>;
        }>(`/installation/repositories?per_page=100&page=${page}`, token);
        repositories.push(...data.repositories);
        if (data.repositories.length < 100) break;
      }
      return repositories.map((repo) => ({
        fullName: repo.full_name,
        defaultBranch: repo.default_branch,
      }));
    },
    async listOpenPullRequests(id, repo) {
      const token = await installationToken(id);
      const pulls = await paged<{ number: number }>(`/repos/${repo}/pulls?state=open`, token);
      return pulls.map((pr) => pr.number);
    },
  };
}
