import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { encode } from "next-auth/jwt";
import { proxy } from "@/proxy";
import { ACCESS_KEY_COOKIE, createSessionToken } from "@/lib/auth/session";
import { oidcSessionCookieName } from "@/lib/auth/oidc-config";

// The real i18n middleware can't load under vitest; locale rewriting isn't what's tested.
vi.mock("next-intl/middleware", () => ({ default: () => () => NextResponse.next() }));

const KEY = "test-access-key";
const OIDC_SECRET = "test-oidc-session-secret-0123456789abcdef";

async function request(path: string, withSession: boolean) {
  const req = new NextRequest(new URL(path, "http://localhost:9999"));
  if (withSession) req.cookies.set(ACCESS_KEY_COOKIE, await createSessionToken(KEY));
  return proxy(req);
}

describe("proxy session handling (access-key mode)", () => {
  beforeEach(() => vi.stubEnv("HINDSIGHT_CP_ACCESS_KEY", KEY));
  afterEach(() => vi.unstubAllEnvs());

  it("marks its own 401 so the browser knows to log in again", async () => {
    const res = await request("/api/banks", false);
    expect(res.status).toBe(401);
    expect(res.headers.get("x-hindsight-session-required")).toBe("1");
  });

  it("sends a signed-in visit to /login on to its returnTo", async () => {
    const res = await request("/login?returnTo=%2Fbanks%2Fa", true);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:9999/banks/a");
  });

  it("never follows an off-site returnTo", async () => {
    const res = await request("/login?returnTo=%2F%2Fevil.com", true);
    expect(res.headers.get("location")).toBe("http://localhost:9999/dashboard");
  });

  it("still shows the login form without a valid session", async () => {
    const res = await request("/login", false);
    expect(res.headers.get("location")).toBeNull();
  });

  it("treats the internal locale rewrite of /login as /login (no redirect loop)", async () => {
    const res = await request("/en/login", false);
    expect(res.headers.get("location")).toBeNull();
  });

  it("keeps returnTo locale-agnostic when the rewrite re-enters the proxy", async () => {
    const res = await request("/en/dashboard", false);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:9999/login?returnTo=%2Fdashboard");
  });
});

describe("proxy body limit", () => {
  afterEach(() => vi.unstubAllEnvs());
  const post = (bytes: number) =>
    proxy(
      new NextRequest(new URL("/api/knowledge-banks/docs/files/ingest", "http://localhost:9999"), {
        method: "POST",
        headers: { "content-length": String(bytes) },
      })
    );

  it("refuses a body over the limit with a 413 rather than letting Next.js truncate it", async () => {
    vi.stubEnv("HINDSIGHT_CP_MAX_UPLOAD_SIZE", "1mb");
    const res = await post(2 * 1024 * 1024);
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({
      error: expect.stringMatching(/too large/),
      limitBytes: 1024 * 1024,
    });
    expect((await post(1024 * 1024)).status).toBe(200);
  });
});

describe("proxy session handling (OIDC mode)", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_SECRET", OIDC_SECRET);
    vi.stubEnv("AUTH_AUTHENTIK_ISSUER", "https://authentik.example/application/o/hindsight");
    vi.stubEnv("AUTH_AUTHENTIK_ID", "client-id");
    vi.stubEnv("AUTH_AUTHENTIK_SECRET", "client-secret");
  });
  afterEach(() => vi.unstubAllEnvs());

  async function oidcRequest(path: string, withSession: boolean) {
    const req = new NextRequest(new URL(path, "http://localhost:9999"));
    if (withSession) {
      const cookieName = oidcSessionCookieName(false);
      const jwt = await encode({
        token: { sub: "user-1", access_token: "idp-token", expires_at: Math.floor(Date.now() / 1000) + 3600 },
        secret: OIDC_SECRET,
        salt: cookieName,
      });
      req.cookies.set(cookieName, jwt);
    }
    return proxy(req);
  }

  it("rejects API calls without a session, marking the 401 as session-required", async () => {
    const res = await oidcRequest("/api/banks", false);
    expect(res.status).toBe(401);
    expect(res.headers.get("x-hindsight-session-required")).toBe("1");
  });

  it("accepts API calls with a valid NextAuth session cookie", async () => {
    const res = await oidcRequest("/api/banks", true);
    expect(res.status).toBe(200);
  });

  it("ignores the access-key cookie in OIDC mode", async () => {
    const req = new NextRequest(new URL("/api/banks", "http://localhost:9999"));
    req.cookies.set(ACCESS_KEY_COOKIE, await createSessionToken(KEY));
    const res = await proxy(req);
    expect(res.status).toBe(401);
  });

  it("redirects unauthenticated pages to /login with returnTo", async () => {
    const res = await oidcRequest("/dashboard", false);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:9999/login?returnTo=%2Fdashboard");
  });

  it("sends a signed-in visit to /login on to its returnTo", async () => {
    const res = await oidcRequest("/login?returnTo=%2Fbanks%2Fa", true);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:9999/banks/a");
  });

  it("keeps auth endpoints and health public", async () => {
    expect((await oidcRequest("/api/auth/session", false)).status).toBe(200);
    expect((await oidcRequest("/api/health", false)).status).toBe(200);
    expect((await oidcRequest("/login", false)).headers.get("location")).toBeNull();
  });

  it("treats the internal locale rewrite of /login as /login (no redirect loop)", async () => {
    const res = await oidcRequest("/en/login", false);
    expect(res.headers.get("location")).toBeNull();
  });

  it("rejects a session cookie signed with a different secret", async () => {
    const req = new NextRequest(new URL("/api/banks", "http://localhost:9999"));
    const cookieName = oidcSessionCookieName(false);
    const jwt = await encode({ token: { sub: "user-1" }, secret: "another-secret", salt: cookieName });
    req.cookies.set(cookieName, jwt);
    const res = await proxy(req);
    expect(res.status).toBe(401);
  });

  it("accepts a chunked session cookie", async () => {
    const cookieName = oidcSessionCookieName(false);
    const jwe = await encode({ token: { sub: "user-1" }, secret: OIDC_SECRET, salt: cookieName });
    const req = new NextRequest(new URL("/api/banks", "http://localhost:9999"));
    const mid = Math.ceil(jwe.length / 2);
    req.cookies.set(`${cookieName}.0`, jwe.slice(0, mid));
    req.cookies.set(`${cookieName}.1`, jwe.slice(mid));
    expect((await proxy(req)).status).toBe(200);
  });

  it("accepts the __Secure- cookie variant on https", async () => {
    const secureName = oidcSessionCookieName(true);
    const jwe = await encode({ token: { sub: "user-1" }, secret: OIDC_SECRET, salt: secureName });
    const req = new NextRequest(new URL("/api/banks", "https://cp.example"));
    req.cookies.set(secureName, jwe);
    expect((await proxy(req)).status).toBe(200);
  });

  it("renders an already-locale-rewritten page instead of redirecting it", async () => {
    const res = await oidcRequest("/en/dashboard", true);
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });
});