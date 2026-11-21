import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { encode } from "next-auth/jwt";

import { requireSession } from "@/lib/auth/require-session";
import { ACCESS_KEY_COOKIE, createSessionToken } from "@/lib/auth/session";
import { oidcSessionCookieName } from "@/lib/auth/oidc-config";

const ACCESS_KEY = "test-access-key";
const OIDC_SECRET = "[REDACTED]";

function request(): NextRequest {
  return new NextRequest(new URL("/api/banks", "http://localhost:9999"));
}

function stubOidc() {
  vi.stubEnv("AUTH_SECRET", OIDC_SECRET);
  vi.stubEnv("AUTH_AUTHENTIK_ISSUER", "https://authentik.example/application/o/hindsight");
  vi.stubEnv("AUTH_AUTHENTIK_ID", "client-id");
  vi.stubEnv("AUTH_AUTHENTIK_SECRET", "client-secret");
}

async function oidcCookie(request: NextRequest, secret = OIDC_SECRET) {
  const cookieName = oidcSessionCookieName(false);
  const jwt = await encode({
    token: { sub: "user-1", access_token: "idp-token" },
    secret,
    salt: cookieName,
  });
  request.cookies.set(cookieName, jwt);
}

afterEach(() => vi.unstubAllEnvs());

describe("requireSession (access-key mode)", () => {
  it("refuses a request with no session cookie", async () => {
    vi.stubEnv("HINDSIGHT_CP_ACCESS_KEY", ACCESS_KEY);
    const denied = await requireSession(request());
    expect(denied?.status).toBe(401);
    expect(denied?.headers.get("x-hindsight-session-required")).toBe("1");
  });

  it("accepts a valid access-key cookie", async () => {
    vi.stubEnv("HINDSIGHT_CP_ACCESS_KEY", ACCESS_KEY);
    const req = request();
    req.cookies.set(ACCESS_KEY_COOKIE, await createSessionToken(ACCESS_KEY));
    expect(await requireSession(req)).toBeNull();
  });

  it("refuses a session cookie signed with another key", async () => {
    vi.stubEnv("HINDSIGHT_CP_ACCESS_KEY", ACCESS_KEY);
    const req = request();
    req.cookies.set(ACCESS_KEY_COOKIE, await createSessionToken("another-key"));
    expect((await requireSession(req))?.status).toBe(401);
  });

  it("allows everything when no auth is configured (open mode)", async () => {
    expect(await requireSession(request())).toBeNull();
  });
});

describe("requireSession (OIDC mode)", () => {
  it("accepts a valid NextAuth session cookie", async () => {
    stubOidc();
    const req = request();
    await oidcCookie(req);
    expect(await requireSession(req)).toBeNull();
  });

  it("refuses a request without a session cookie", async () => {
    stubOidc();
    expect((await requireSession(request()))?.status).toBe(401);
  });

  it("ignores an access-key cookie", async () => {
    stubOidc();
    vi.stubEnv("HINDSIGHT_CP_ACCESS_KEY", ACCESS_KEY);
    const req = request();
    req.cookies.set(ACCESS_KEY_COOKIE, await createSessionToken(ACCESS_KEY));
    expect((await requireSession(req))?.status).toBe(401);
  });

  it("refuses a session cookie signed with a different secret", async () => {
    stubOidc();
    const req = request();
    await oidcCookie(req, "another-secret");
    expect((await requireSession(req))?.status).toBe(401);
  });
});
