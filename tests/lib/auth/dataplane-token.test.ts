import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ResponseCookies } from "next/dist/server/web/spec-extension/cookies";
import { encode } from "next-auth/jwt";

import { oidcSessionCookieName } from "@/lib/auth/oidc-config";

const SECRET = "[REDACTED]";
const ISSUER = "https://authentik.example/application/o/hindsight";
const COOKIE = oidcSessionCookieName(false);

// next/headers is only usable inside a real request context; the helper's
// cookie writes are asserted against this mock jar instead.
const jar = { set: vi.fn(), delete: vi.fn() };
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => jar) }));

function stubOidcEnv() {
  vi.stubEnv("AUTH_SECRET", SECRET);
  vi.stubEnv("AUTH_AUTHENTIK_ISSUER", ISSUER);
  vi.stubEnv("AUTH_AUTHENTIK_ID", "client-id");
  vi.stubEnv("AUTH_AUTHENTIK_SECRET", "client-secret");
}

async function sessionCookie(payload: Record<string, unknown>): Promise<string> {
  return encode({ token: payload, secret: SECRET, salt: COOKIE });
}

function requestWithCookie(value: string): NextRequest {
  const req = new NextRequest(new URL("/api/banks", "http://localhost:9999"));
  req.cookies.set(COOKIE, value);
  return req;
}

/**
 * The deletion must repeat the write's attributes: a delete is just a
 * Set-Cookie with a past expiry, and browsers ignore a `__Secure-` one that
 * omits `Secure` (RFC 6265bis), leaving the session cookie alive.
 */
function expectCookieDeleted(name: string, secure: boolean) {
  expect(jar.delete).toHaveBeenCalledWith({
    name,
    path: "/",
    secure,
    sameSite: "lax",
    httpOnly: true,
  });
}

/** Fresh module per test: the token-endpoint cache and env reads are module-level. */
async function loadHelper() {
  vi.resetModules();
  return import("@/lib/auth/dataplane-token");
}

function mockFetch(responses: Array<{ url: string; status: number; body: unknown }>) {
  const calls: Array<{ url: string; body?: string }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, body: init?.body ? String(init.body) : undefined });
      const match = responses.find((r) => u.startsWith(r.url));
      if (!match) throw new Error(`unexpected fetch: ${u}`);
      return {
        ok: match.status >= 200 && match.status < 300,
        status: match.status,
        json: async () => match.body,
      };
    })
  );
  return calls;
}

const discovery = {
  url: `${ISSUER}/.well-known/openid-configuration`,
  status: 200,
  body: { token_endpoint: `${ISSUER}/token/` },
};

describe("dataplaneToken — access-key mode", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns the shared dataplane key", async () => {
    vi.stubEnv("HINDSIGHT_CP_DATAPLANE_API_KEY", "shared-key-123456");
    const { dataplaneToken } = await loadHelper();
    const req = new NextRequest(new URL("/api/banks", "http://localhost:9999"));
    expect(await dataplaneToken(req)).toBe("shared-key-123456");
  });

  it("returns null when no key is configured (public dataplane)", async () => {
    vi.stubEnv("HINDSIGHT_CP_DATAPLANE_API_KEY", "");
    const { dataplaneToken } = await loadHelper();
    const req = new NextRequest(new URL("/api/banks", "http://localhost:9999"));
    expect(await dataplaneToken(req)).toBeNull();
  });
});

describe("dataplaneToken — OIDC mode", () => {
  beforeEach(() => {
    stubOidcEnv();
    jar.set.mockClear();
    jar.delete.mockClear();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns null without a session cookie", async () => {
    const { dataplaneToken } = await loadHelper();
    const req = new NextRequest(new URL("/api/banks", "http://localhost:9999"));
    expect(await dataplaneToken(req)).toBeNull();
  });

  it("returns the user's access token while it is fresh, without any fetch", async () => {
    const calls = mockFetch([]);
    const { dataplaneToken } = await loadHelper();
    const cookie = await sessionCookie({
      sub: "alice",
      access_token: "alice-access-token",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    });
    expect(await dataplaneToken(requestWithCookie(cookie))).toBe("alice-access-token");
    expect(calls).toHaveLength(0);
    expect(jar.set).not.toHaveBeenCalled();
  });

  it("treats a token without expires_at as fresh", async () => {
    mockFetch([]);
    const { dataplaneToken } = await loadHelper();
    const cookie = await sessionCookie({ sub: "alice", access_token: "no-expiry-token" });
    expect(await dataplaneToken(requestWithCookie(cookie))).toBe("no-expiry-token");
  });

  it("refreshes an expired token and writes the rotated session cookie", async () => {
    const calls = mockFetch([
      discovery,
      {
        url: `${ISSUER}/token/`,
        status: 200,
        body: { access_token: "new-access", refresh_token: "new-refresh", expires_in: 300 },
      },
    ]);
    const { dataplaneToken } = await loadHelper();
    const cookie = await sessionCookie({
      sub: "alice",
      access_token: "old-access",
      refresh_token: "old-refresh",
      expires_at: Math.floor(Date.now() / 1000) - 10,
    });

    expect(await dataplaneToken(requestWithCookie(cookie))).toBe("new-access");

    // Discovery + token endpoint, with the refresh grant and client credentials.
    expect(calls).toHaveLength(2);
    expect(calls[1].body).toContain("grant_type=refresh_token");
    expect(calls[1].body).toContain("refresh_token=old-refresh");
    expect(calls[1].body).toContain("client_id=client-id");

    // The session cookie was rewritten (single chunk for a small JWE).
    expect(jar.set).toHaveBeenCalledTimes(1);
    const written = jar.set.mock.calls[0][0] as { name: string; value: string; httpOnly: boolean };
    expect(written.name).toBe(COOKIE);
    expect(written.httpOnly).toBe(true);
    expect(written.value).not.toBe(cookie);
  });

  it("returns null when the IdP rejects the refresh (re-login needed)", async () => {
    mockFetch([discovery, { url: `${ISSUER}/token/`, status: 400, body: { error: "invalid_grant" } }]);
    const { dataplaneToken } = await loadHelper();
    const cookie = await sessionCookie({
      sub: "alice",
      access_token: "old-access",
      refresh_token: "old-refresh",
      expires_at: Math.floor(Date.now() / 1000) - 10,
    });
    expect(await dataplaneToken(requestWithCookie(cookie))).toBeNull();
    expect(jar.set).not.toHaveBeenCalled();
  });

  it("returns null for an expired token with no refresh token", async () => {
    const calls = mockFetch([]);
    const { dataplaneToken } = await loadHelper();
    const cookie = await sessionCookie({
      sub: "alice",
      access_token: "old-access",
      expires_at: Math.floor(Date.now() / 1000) - 10,
    });
    expect(await dataplaneToken(requestWithCookie(cookie))).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("shares one refresh across concurrent requests with the same session", async () => {
    const calls = mockFetch([
      discovery,
      {
        url: `${ISSUER}/token/`,
        status: 200,
        body: { access_token: "new-access", refresh_token: "new-refresh", expires_in: 300 },
      },
    ]);
    const { dataplaneToken } = await loadHelper();
    const cookie = await sessionCookie({
      sub: "alice",
      access_token: "old-access",
      refresh_token: "old-refresh",
      expires_at: Math.floor(Date.now() / 1000) - 10,
    });

    const results = await Promise.all([
      dataplaneToken(requestWithCookie(cookie)),
      dataplaneToken(requestWithCookie(cookie)),
      dataplaneToken(requestWithCookie(cookie)),
    ]);
    expect(results).toEqual(["new-access", "new-access", "new-access"]);
    // One discovery + one token call, not three — authentik rotates refresh
    // tokens, so concurrent refreshes with the same token would be rejected.
    expect(calls.filter((c) => c.url.startsWith(`${ISSUER}/token/`))).toHaveLength(1);
  });

  it("chunks a large session cookie the way NextAuth reads it", async () => {
    mockFetch([
      discovery,
      {
        url: `${ISSUER}/token/`,
        status: 200,
        body: { access_token: "x".repeat(6000), refresh_token: "new-refresh", expires_in: 300 },
      },
    ]);
    const { dataplaneToken } = await loadHelper();
    const cookie = await sessionCookie({
      sub: "alice",
      access_token: "old-access",
      refresh_token: "old-refresh",
      expires_at: Math.floor(Date.now() / 1000) - 10,
    });

    expect(await dataplaneToken(requestWithCookie(cookie))).toBe("x".repeat(6000));
    const names = jar.set.mock.calls.map((c) => (c[0] as { name: string }).name);
    expect(names.length).toBeGreaterThan(1);
    expect(names).toContain(`${COOKIE}.0`);
    expect(names).toContain(`${COOKIE}.1`);
    // The old unchunked cookie must be removed so reads don't mix values.
    expectCookieDeleted(COOKIE, false);
  });

  it("clears the dead __Secure- session cookie in a form the browser honors", async () => {
    mockFetch([]);
    const { dataplaneToken } = await loadHelper();
    const secureName = oidcSessionCookieName(true);
    const jwe = await encode({
      token: { sub: "alice", expires_at: Math.floor(Date.now() / 1000) + 3600 },
      secret: SECRET,
      salt: secureName,
    });
    const req = new NextRequest(new URL("/api/banks", "https://cp.example"));
    req.cookies.set(secureName, jwe);

    expect(await dataplaneToken(req)).toBeNull();
    expectCookieDeleted(secureName, true);

    // Serialize it the way next/headers writes it. Without `Secure` the browser
    // rejects the deletion outright and the 30-day cookie survives the logout.
    const headers = new Headers();
    new ResponseCookies(headers).delete(jar.delete.mock.calls[0][0]);
    const [setCookie] = headers.getSetCookie();
    expect(setCookie).toContain(`${secureName}=;`);
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  });

  it("clears the session when the decoded JWT has no access token", async () => {
    mockFetch([]);
    const { dataplaneToken } = await loadHelper();
    const cookie = await sessionCookie({
      sub: "alice",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    });
    expect(await dataplaneToken(requestWithCookie(cookie))).toBeNull();
    // The cookie decodes fine, so the proxy still lets it through: leaving it
    // set means a permanent unauthenticated 401 storm with no logout.
    expectCookieDeleted(COOKIE, false);
  });

  it("ignores a cookie encrypted with a different secret", async () => {
    mockFetch([]);
    const { dataplaneToken } = await loadHelper();
    const foreign = await encode({
      token: { sub: "alice", access_token: "stolen?" },
      secret: "another-secret",
      salt: COOKIE,
    });
    expect(await dataplaneToken(requestWithCookie(foreign))).toBeNull();
  });

  it("reads a chunked session cookie back through getToken", async () => {
    mockFetch([]);
    const { dataplaneToken } = await loadHelper();
    const jwe = await sessionCookie({
      sub: "alice",
      access_token: "chunked-token",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    });
    const req = new NextRequest(new URL("/api/banks", "http://localhost:9999"));
    const mid = Math.ceil(jwe.length / 2);
    req.cookies.set(`${COOKIE}.0`, jwe.slice(0, mid));
    req.cookies.set(`${COOKIE}.1`, jwe.slice(mid));
    expect(await dataplaneToken(req)).toBe("chunked-token");
  });

  it("finds the __Secure- cookie variant on https requests", async () => {
    mockFetch([]);
    const { dataplaneToken } = await loadHelper();
    const secureName = oidcSessionCookieName(true);
    const jwe = await encode({
      token: { sub: "alice", access_token: "secure-token", expires_at: Math.floor(Date.now() / 1000) + 3600 },
      secret: SECRET,
      salt: secureName,
    });
    const req = new NextRequest(new URL("/api/banks", "https://cp.example"));
    req.cookies.set(secureName, jwe);
    expect(await dataplaneToken(req)).toBe("secure-token");
  });

  it("finds the session even when the secure/non-secure view disagrees", async () => {
    mockFetch([]);
    const { dataplaneToken } = await loadHelper();
    // http request, but the cookie was set under the __Secure- name (e.g. a
    // proxy whose X-Forwarded-Proto disagrees with NextAuth's trustHost).
    const secureName = oidcSessionCookieName(true);
    const jwe = await encode({
      token: { sub: "alice", access_token: "mismatch-token", expires_at: Math.floor(Date.now() / 1000) + 3600 },
      secret: SECRET,
      salt: secureName,
    });
    const req = new NextRequest(new URL("/api/banks", "http://localhost:9999"));
    req.cookies.set(secureName, jwe);
    expect(await dataplaneToken(req)).toBe("mismatch-token");
  });
});

describe("dataplaneToken — refresh rotation edge cases", () => {
  beforeEach(() => {
    stubOidcEnv();
    jar.set.mockClear();
    jar.delete.mockClear();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const expiredCookie = () =>
    sessionCookie({
      sub: "alice",
      access_token: "old-access",
      refresh_token: "old-refresh",
      expires_at: Math.floor(Date.now() / 1000) - 10,
    });

  const okRefresh = [
    discovery,
    {
      url: `${ISSUER}/token/`,
      status: 200,
      body: { access_token: "new-access", refresh_token: "new-refresh", expires_in: 300 },
    },
  ];

  it("late requests with the pre-rotation cookie reuse the settled refresh", async () => {
    const calls = mockFetch(okRefresh);
    const { dataplaneToken } = await loadHelper();
    const cookie = await expiredCookie();

    expect(await dataplaneToken(requestWithCookie(cookie))).toBe("new-access");
    // Second fetch wave: same old cookie, refresh already settled. Must NOT
    // refresh again (the refresh token was consumed by the rotation).
    expect(await dataplaneToken(requestWithCookie(cookie))).toBe("new-access");
    expect(calls.filter((c) => c.url.startsWith(`${ISSUER}/token/`))).toHaveLength(1);
    // The late request still gets the rotated cookie on its own response.
    expect(jar.set).toHaveBeenCalledTimes(2);
  });

  it("clears the session when the IdP rejects the refresh token (invalid_grant)", async () => {
    mockFetch([
      discovery,
      { url: `${ISSUER}/token/`, status: 400, body: { error: "invalid_grant" } },
    ]);
    const { dataplaneToken } = await loadHelper();
    const cookie = await expiredCookie();

    expect(await dataplaneToken(requestWithCookie(cookie))).toBeNull();
    // Dead session: cookie cleared so the next request gets a session-required
    // 401 and the UI re-logins instead of being locked out for 30 days.
    expectCookieDeleted(COOKIE, false);
  });

  it("still resolves null when clearing the dead session cookie throws", async () => {
    mockFetch([
      discovery,
      { url: `${ISSUER}/token/`, status: 400, body: { error: "invalid_grant" } },
    ]);
    const { dataplaneToken } = await loadHelper();
    const cookie = await expiredCookie();
    // A jar failure must not reject the promise shared by concurrent requests
    // (they would 500) and must not surface as an unhandled rejection.
    jar.delete.mockImplementation(() => {
      throw new Error("cookie jar unavailable");
    });
    try {
      await expect(dataplaneToken(requestWithCookie(cookie))).resolves.toBeNull();
    } finally {
      jar.delete.mockReset();
    }
  });

  it("clears the session on a transient IdP outage too", async () => {
    mockFetch([]); // discovery fetch throws
    const { dataplaneToken } = await loadHelper();
    const cookie = await expiredCookie();
    expect(await dataplaneToken(requestWithCookie(cookie))).toBeNull();
    // An outage leaves no token to send. Keeping the cookie would let the proxy
    // gate pass while every dataplane call 401s; clearing it routes the next
    // request through the session-required 401 and back to /login.
    expectCookieDeleted(COOKIE, false);
  });

  it("does not negative-cache a failed refresh — the next request retries", async () => {
    let tokenCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const u = String(url);
        if (u.startsWith(`${ISSUER}/.well-known`)) {
          return { ok: true, status: 200, json: async () => ({ token_endpoint: `${ISSUER}/token/` }) };
        }
        tokenCalls += 1;
        // First attempt hits a transient IdP failure; the retry succeeds.
        return tokenCalls === 1
          ? { ok: false, status: 503, json: async () => ({}) }
          : {
              ok: true,
              status: 200,
              json: async () => ({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 300 }),
            };
      })
    );
    const { dataplaneToken } = await loadHelper();
    const cookie = await expiredCookie();

    expect(await dataplaneToken(requestWithCookie(cookie))).toBeNull();
    // A cached null would keep every request unauthenticated for a minute even
    // after the IdP recovers.
    expect(await dataplaneToken(requestWithCookie(cookie))).toBe("new-access");
    expect(tokenCalls).toBe(2);
  });

  it("deletes stale higher-index chunks when the rotated cookie shrinks", async () => {
    mockFetch(okRefresh);
    const { dataplaneToken } = await loadHelper();
    const jwe = await expiredCookie();
    const req = new NextRequest(new URL("/api/banks", "http://localhost:9999"));
    const third = Math.ceil(jwe.length / 3);
    req.cookies.set(`${COOKIE}.0`, jwe.slice(0, third));
    req.cookies.set(`${COOKIE}.1`, jwe.slice(third, 2 * third));
    req.cookies.set(`${COOKIE}.2`, jwe.slice(2 * third));

    expect(await dataplaneToken(req)).toBe("new-access");
    const deleted = jar.delete.mock.calls.map((c) => (c[0] as { name: string }).name);
    expect(deleted).toContain(`${COOKIE}.0`);
    expect(deleted).toContain(`${COOKIE}.1`);
    expect(deleted).toContain(`${COOKIE}.2`);
  });

  it("deletes stale __Secure- chunks with Secure when the rotated cookie shrinks", async () => {
    mockFetch(okRefresh);
    const { dataplaneToken } = await loadHelper();
    const secureName = oidcSessionCookieName(true);
    const jwe = await encode({
      token: {
        sub: "alice",
        access_token: "old-access",
        refresh_token: "old-refresh",
        expires_at: Math.floor(Date.now() / 1000) - 10,
      },
      secret: SECRET,
      salt: secureName,
    });
    const req = new NextRequest(new URL("/api/banks", "https://cp.example"));
    const third = Math.ceil(jwe.length / 3);
    req.cookies.set(`${secureName}.0`, jwe.slice(0, third));
    req.cookies.set(`${secureName}.1`, jwe.slice(third, 2 * third));
    req.cookies.set(`${secureName}.2`, jwe.slice(2 * third));

    expect(await dataplaneToken(req)).toBe("new-access");
    for (const chunk of [`${secureName}.0`, `${secureName}.1`, `${secureName}.2`]) {
      expectCookieDeleted(chunk, true);
    }
  });

  it("writes the rotated cookie with NextAuth's 30-day maxAge", async () => {
    mockFetch(okRefresh);
    const { dataplaneToken } = await loadHelper();
    expect(await dataplaneToken(requestWithCookie(await expiredCookie()))).toBe("new-access");
    const written = jar.set.mock.calls[0][0] as { maxAge: number };
    expect(written.maxAge).toBe(30 * 24 * 60 * 60);
  });
});