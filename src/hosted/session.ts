import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Stateless signed sessions. The session is a base64url JSON payload plus an
 * HMAC-SHA256 tag, stored in an HttpOnly cookie. No server-side session store —
 * the signature is the trust. Payload holds who you are and which GitHub
 * accounts you can see (resolved at login).
 */
export interface Session {
  login: string;
  name: string | null;
  accounts: string[];
  /** issued-at (ms); sessions expire after MAX_AGE. */
  iat: number;
}

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_COOKIE = "covallaby_session";

function sign(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

export function encodeSession(session: Session, secret: string): string {
  const body = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

export function decodeSession(token: string | undefined, secret: string): Session | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot === -1) return null;
  const body = token.slice(0, dot);
  const tag = token.slice(dot + 1);
  const expected = sign(body, secret);
  const a = Buffer.from(tag);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const session = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Session;
    if (typeof session.iat !== "number" || Date.now() - session.iat > MAX_AGE_MS) return null;
    return session;
  } catch {
    return null;
  }
}

export function sessionCookie(token: string, secure: boolean): string {
  const flags = ["Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${MAX_AGE_MS / 1000}`];
  if (secure) flags.push("Secure");
  return `${SESSION_COOKIE}=${token}; ${flags.join("; ")}`;
}

export function clearCookie(secure: boolean): string {
  const flags = ["Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) flags.push("Secure");
  return `${SESSION_COOKIE}=; ${flags.join("; ")}`;
}

export function readCookie(header: string | undefined, name: string): string | null {
  const match = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(header ?? "");
  return match ? match[1]! : null;
}
