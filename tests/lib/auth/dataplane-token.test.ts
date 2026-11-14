import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
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
    expect(jar.delete).toHaveBeenCalledWith(COOKIE);
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
    const calls = mockFetch([
      discovery,
      { url: `${ISSUER}/token/`, status: 400, body: { error: "invalid_grant" } },
    ]);
    const { dataplaneToken } = await loadHelper();
    const cookie = await expiredCookie();

    expect(await dataplaneToken(requestWithCookie(cookie))).toBeNull();
    // Dead session: cookie cleared so the next request gets a session-required
    // 401 and the UI re-logins instead of being locked out for 30 days.
    expect(jar.delete).toHaveBeenCalledWith(COOKIE);
    // The failure is cached briefly: no hammering the IdP with the dead token.
    expect(await dataplaneToken(requestWithCookie(cookie))).toBeNull();
    expect(calls.filter((c) => c.url.startsWith(`${ISSUER}/token/`))).toHaveLength(1);
  });

  it("keeps the session on a transient IdP outage", async () => {
    mockFetch([]); // discovery fetch throws -> transient
    const { dataplaneToken } = await loadHelper();
    const cookie = await expiredCookie();
    expect(await dataplaneToken(requestWithCookie(cookie))).toBeNull();
    expect(jar.delete).not.toHaveBeenCalled();
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
    const deleted = jar.delete.mock.calls.map((c) => c[0]);
    expect(deleted).toContain(`${COOKIE}.0`);
    expect(deleted).toContain(`${COOKIE}.1`);
    expect(deleted).toContain(`${COOKIE}.2`);
  });

  it("writes the rotated cookie with NextAuth's 30-day maxAge", async () => {
    mockFetch(okRefresh);
    const { dataplaneToken } = await loadHelper();
    expect(await dataplaneToken(requestWithCookie(await expiredCookie()))).toBe("new-access");
    const written = jar.set.mock.calls[0][0] as { maxAge: number };
    expect(written.maxAge).toBe(30 * 24 * 60 * 60);
  });
});