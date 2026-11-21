import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { POST } from "@/app/api/auth/login/route";

const ACCESS_KEY = "test-access-key";
const FIXED_NOW = new Date("2026-01-01T00:00:00Z");

function login(ip: string, key = "wrong") {
  return POST(
    new NextRequest("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ key }),
    })
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
  vi.stubEnv("HINDSIGHT_CP_ACCESS_KEY", ACCESS_KEY);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("POST /api/auth/login", () => {
  it("logs in with the right key", async () => {
    const response = await login("10.0.0.1", ACCESS_KEY);
    expect(response.status).toBe(200);
    expect(response.cookies.get("hindsight_cp_access")?.value).toBeTruthy();
  });

  it("rejects a wrong key", async () => {
    expect((await login("10.0.0.2")).status).toBe(401);
  });

  it("rate limits rapid attempts from one address", async () => {
    for (let attempt = 1; attempt <= 5; attempt++) {
      expect((await login("10.0.0.3")).status).toBe(401);
    }

    const limited = await login("10.0.0.3");
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("does not rate limit a different address", async () => {
    for (let attempt = 1; attempt <= 6; attempt++) {
      await login("10.0.0.4");
    }
    expect((await login("10.0.0.5")).status).toBe(401);
  });

  it("keys on the ingress-appended address, not a spoofed leftmost entry", async () => {
    // A client can send any X-Forwarded-For it likes; the ingress appends the
    // address it actually saw. Rotating the leftmost entry must not reset the
    // bucket.
    for (let attempt = 1; attempt <= 5; attempt++) {
      expect((await login(`10.9.9.${attempt}, 10.0.0.6`)).status).toBe(401);
    }
    expect((await login("10.9.9.99, 10.0.0.6")).status).toBe(429);
  });
});
