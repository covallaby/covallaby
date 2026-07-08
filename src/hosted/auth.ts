import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import type { HostedConfig } from "./config.js";
import { GITHUB_AUTHORIZE_URL, type GitHubClient } from "./github.js";
import {
  SESSION_COOKIE,
  clearCookie,
  decodeSession,
  encodeSession,
  readCookie,
  sessionCookie,
} from "./session.js";

const STATE_COOKIE = "covallaby_oauth_state";

/** A signed, short-lived state token binds the callback to this browser (CSRF). */
function makeState(secret: string): string {
  const nonce = randomBytes(12).toString("base64url");
  const tag = createHmac("sha256", secret).update(nonce).digest("base64url");
  return `${nonce}.${tag}`;
}
function checkState(value: string | null, secret: string): boolean {
  if (!value) return false;
  const dot = value.lastIndexOf(".");
  if (dot === -1) return false;
  const expected = createHmac("sha256", secret).update(value.slice(0, dot)).digest("base64url");
  const a = Buffer.from(value.slice(dot + 1));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function currentSession(cookieHeader: string | undefined, secret: string) {
  return decodeSession(readCookie(cookieHeader, SESSION_COOKIE) ?? undefined, secret);
}

export function authRoutes(config: HostedConfig, github: GitHubClient): Hono {
  const app = new Hono();
  const secure = config.baseUrl.startsWith("https://");

  app.get("/auth/github/login", (c) => {
    const state = makeState(config.sessionSecret);
    const url = new URL(GITHUB_AUTHORIZE_URL);
    url.searchParams.set("client_id", config.github.clientId);
    url.searchParams.set("redirect_uri", `${config.baseUrl}/auth/github/callback`);
    url.searchParams.set("scope", "read:org");
    url.searchParams.set("state", state.slice(0, state.lastIndexOf("."))); // nonce only in URL
    // store the full signed state in a cookie to verify on return
    c.header(
      "Set-Cookie",
      `${STATE_COOKIE}=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secure ? "; Secure" : ""}`,
    );
    return c.redirect(url.toString());
  });

  app.get("/auth/github/callback", async (c) => {
    const code = c.req.query("code");
    const nonce = c.req.query("state");
    const cookieState = readCookie(c.req.header("cookie"), STATE_COOKIE);
    // the cookie holds "nonce.tag"; the URL carries only the nonce
    if (!code || !nonce || !cookieState || cookieState.split(".")[0] !== nonce) {
      return c.text("OAuth state mismatch — please try signing in again.", 400);
    }
    if (!checkState(cookieState, config.sessionSecret)) {
      return c.text("OAuth state invalid.", 400);
    }
    try {
      const token = await github.exchangeCode(code);
      const [user, accounts] = await Promise.all([
        github.getUser(token),
        github.getAccounts(token),
      ]);
      const session = encodeSession(
        { login: user.login, name: user.name, accounts, iat: Date.now() },
        config.sessionSecret,
      );
      c.header("Set-Cookie", sessionCookie(session, secure));
      return c.redirect("/");
    } catch (error) {
      return c.text(`Sign-in failed: ${(error as Error).message}`, 502);
    }
  });

  app.post("/auth/logout", (c) => {
    c.header("Set-Cookie", clearCookie(secure));
    return c.redirect("/");
  });

  app.get("/api/v1/me", (c) => {
    const session = currentSession(c.req.header("cookie"), config.sessionSecret);
    if (!session) return c.json({ authenticated: false });
    return c.json({
      authenticated: true,
      login: session.login,
      name: session.name,
      accounts: session.accounts,
    });
  });

  return app;
}
