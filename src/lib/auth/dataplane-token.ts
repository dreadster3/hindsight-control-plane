/**
 * Server-side resolution of the bearer token to send to the Hindsight API.
 *
 * - Access-key mode (no OIDC env): the shared HINDSIGHT_CP_DATAPLANE_API_KEY,
 *   exactly as before.
 * - OIDC mode: the logged-in user's IdP access token, read from the encrypted
 *   NextAuth session cookie. Expired tokens are refreshed against the IdP
 *   (refresh-token rotation) and the updated session cookie is written back.
 *   The token never reaches the browser.
 *
 * The Hindsight API's hybrid-tenant extension verifies this token and resolves
 * it to the user's schema, so every dataplane call — bank listing included —
 * is automatically scoped to the logged-in user.
 */
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { decode, encode } from "next-auth/jwt";
import type { JWT } from "next-auth/jwt";

import { findSessionCookie, isOidcEnabled } from "@/lib/auth/oidc-config";

const DATAPLANE_API_KEY = process.env.HINDSIGHT_CP_DATAPLANE_API_KEY || "";

/** Refresh this many seconds before expiry so in-flight requests don't race it. */
const REFRESH_MARGIN_SECONDS = 30;

/**
 * NextAuth chunks session cookies larger than one 4KB cookie into
 * `<name>.0`, `<name>.1`, … (see @auth/core SessionStore). IdP tokens can push
 * the JWE past that, so writes must chunk the same way reads expect.
 */
const COOKIE_CHUNK_SIZE = 4096 - 160;

/** Match NextAuth's default session lifetime (its own cookie set uses 30 days). */
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/** A hung IdP must not pin every request waiting at the refresh boundary. */
const IDP_TIMEOUT_MS = 5000;

/**
 * Refresh results are kept briefly for requests that still carry the
 * pre-rotation cookie (the browser hasn't processed the first Set-Cookie yet).
 * Without this, a second fetch wave would refresh again with the already
 * consumed refresh token and be rejected by the IdP's rotation.
 */
const REFRESH_RESULT_TTL_MS = 60_000;

/** Cached OIDC discovery — one fetch per process, retried on next call if it failed. */
let tokenEndpointPromise: Promise<string> | null = null;

function getTokenEndpoint(): Promise<string> {
  if (!tokenEndpointPromise) {
    const issuer = (process.env.AUTH_AUTHENTIK_ISSUER || "").replace(/\/+$/, "");
    tokenEndpointPromise = fetch(`${issuer}/.well-known/openid-configuration`, {
      signal: AbortSignal.timeout(IDP_TIMEOUT_MS),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status}`);
        const doc = (await res.json()) as { token_endpoint?: string };
        if (!doc.token_endpoint) throw new Error("OIDC discovery missing token_endpoint");
        return doc.token_endpoint;
      })
      .catch((err) => {
        tokenEndpointPromise = null;
        throw err;
      });
  }
  return tokenEndpointPromise;
}

/**
 * One in-flight refresh per session cookie: the dashboard fires many parallel
 * requests, and authentik rotates refresh tokens — a second concurrent refresh
 * with the same token would be rejected. Late requests share the first result.
 */
const refreshLocks = new Map<string, Promise<string | null>>();

/** raw pre-rotation cookie → settled successful refresh (see REFRESH_RESULT_TTL_MS). */
const refreshResults = new Map<string, { at: number; accessToken: string; cookieValue: string }>();

type RefreshOutcome =
  | { kind: "ok"; jwt: JWT }
  /** No usable token came back (rejected credential, IdP down, bad response). */
  | { kind: "failed" };

async function refreshAccessToken(jwt: JWT): Promise<RefreshOutcome> {
  if (!jwt.refresh_token) return { kind: "failed" };
  let res: Response;
  try {
    const endpoint = await getTokenEndpoint();
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: jwt.refresh_token,
        client_id: process.env.AUTH_AUTHENTIK_ID || "",
        client_secret: process.env.AUTH_AUTHENTIK_SECRET || "",
      }),
      signal: AbortSignal.timeout(IDP_TIMEOUT_MS),
    });
  } catch (err) {
    console.error(
      "[Control Plane] OIDC refresh failed (IdP unreachable):",
      err instanceof Error ? err.message : String(err)
    );
    return { kind: "failed" };
  }
  if (!res.ok) {
    // Status only — the body can carry token material.
    console.error(`[Control Plane] OIDC refresh rejected with status ${res.status}`);
    return { kind: "failed" };
  }
  try {
    const data = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!data.access_token) return { kind: "failed" };
    return {
      kind: "ok",
      jwt: {
        ...jwt,
        access_token: data.access_token,
        // Keep the old refresh token if the IdP did not rotate it.
        refresh_token: data.refresh_token ?? jwt.refresh_token,
        expires_at: Math.floor(Date.now() / 1000) + (data.expires_in ?? 300),
      },
    };
  } catch {
    return { kind: "failed" };
  }
}

/** Replace the session cookie with `value`, chunked like NextAuth does. */
async function writeSessionCookie(
  request: NextRequest,
  cookieName: string,
  value: string
): Promise<void> {
  const jar = await cookies();
  const chunks: Array<{ name: string; value: string }> = [];
  if (value.length <= COOKIE_CHUNK_SIZE) {
    chunks.push({ name: cookieName, value });
  } else {
    for (let i = 0; i * COOKIE_CHUNK_SIZE < value.length; i++) {
      chunks.push({
        name: `${cookieName}.${i}`,
        value: value.slice(i * COOKIE_CHUNK_SIZE, (i + 1) * COOKIE_CHUNK_SIZE),
      });
    }
  }
  const newNames = new Set(chunks.map((c) => c.name));
  // Drop stale chunks from a previous (possibly differently-sized) cookie.
  for (const existing of request.cookies.getAll()) {
    if (
      (existing.name === cookieName || existing.name.startsWith(`${cookieName}.`)) &&
      !newNames.has(existing.name)
    ) {
      jar.delete(existing.name);
    }
  }
  for (const chunk of chunks) {
    jar.set({
      name: chunk.name,
      value: chunk.value,
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: cookieName.startsWith("__Secure-"),
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
  }
}

/** Delete every chunk of the session cookie (dead session → force re-login). */
async function clearSessionCookie(request: NextRequest, cookieName: string): Promise<void> {
  const jar = await cookies();
  for (const existing of request.cookies.getAll()) {
    if (existing.name === cookieName || existing.name.startsWith(`${cookieName}.`)) {
      jar.delete(existing.name);
    }
  }
}

/**
 * Best-effort clear. The jar can throw outside a mutable-cookie context; that
 * must not reject the shared refresh promise (see the unhandled rejection at
 * `void pending.finally(...)`), so it is logged and swallowed.
 */
async function clearSessionCookieSafely(
  request: NextRequest,
  cookieName: string
): Promise<void> {
  try {
    await clearSessionCookie(request, cookieName);
  } catch (err) {
    console.error(
      "[Control Plane] OIDC session cookie clear failed:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

/**
 * The bearer token for a dataplane request, or null when there is none.
 * In OIDC mode null means "no valid session": a failed refresh clears the
 * session cookie, so the next request is refused by the proxy's
 * session-required 401 and the UI returns to /login.
 */
export async function dataplaneToken(request: NextRequest): Promise<string | null> {
  if (!isOidcEnabled()) {
    return DATAPLANE_API_KEY || null;
  }

  const secret = process.env.AUTH_SECRET as string;
  const session = await findSessionCookie(request, secret);
  if (!session) return null;
  const { raw, cookieName } = session;

  let jwt: JWT | null;
  try {
    jwt = await decode({ token: raw, secret, salt: cookieName });
  } catch {
    // Not decryptable with our secret (forged, or from another deployment).
    return null;
  }
  if (!jwt?.access_token) {
    // Decodes, but carries no token: the proxy still accepts this session, so
    // leaving it set means every dataplane call 401s with no way to log out.
    await clearSessionCookieSafely(request, cookieName);
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (!jwt.expires_at || jwt.expires_at - now > REFRESH_MARGIN_SECONDS) {
    return jwt.access_token;
  }

  // A refresh already settled for this exact cookie: reuse its result (and
  // re-set the rotated cookie on this response) instead of refreshing again.
  const cached = refreshResults.get(raw);
  if (cached && Date.now() - cached.at < REFRESH_RESULT_TTL_MS) {
    await writeSessionCookie(request, cookieName, cached.cookieValue);
    return cached.accessToken;
  }

  // Expired (or about to be): refresh once per session, share the result.
  let pending = refreshLocks.get(raw);
  if (!pending) {
    pending = (async () => {
      try {
        const outcome = await refreshAccessToken(jwt);
        if (outcome.kind === "ok" && outcome.jwt.access_token) {
          const value = await encode({ token: outcome.jwt, secret, salt: cookieName });
          await writeSessionCookie(request, cookieName, value);
          refreshResults.set(raw, {
            at: Date.now(),
            accessToken: outcome.jwt.access_token,
            cookieValue: value,
          });
          return outcome.jwt.access_token;
        }
      } catch (err) {
        console.error(
          "[Control Plane] OIDC session refresh errored:",
          err instanceof Error ? err.message : String(err)
        );
      }
      // Any failure — rejected credential or IdP outage — leaves no token to
      // send, and the request would go out unauthenticated. Clear the session
      // so the next request gets the proxy's session-required 401 and the UI
      // re-logins, instead of passing the gate for 30 days while every
      // dataplane call 401s. Only successes are cached, so a later request
      // retries the IdP rather than replaying this failure.
      await clearSessionCookieSafely(request, cookieName);
      return null;
    })();
    refreshLocks.set(raw, pending);
    void pending.finally(() => refreshLocks.delete(raw));
  }
  return pending;
}