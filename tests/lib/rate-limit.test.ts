import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { clientIp, takeToken } from "@/lib/rate-limit";

function req(headers: Record<string, string> = {}) {
  return new NextRequest(new URL("/api/auth/login", "http://localhost:9999"), { headers });
}

describe("clientIp", () => {
  it("prefers the address Envoy detected", () => {
    const ip = clientIp(
      req({
        "x-envoy-external-address": "203.0.113.9",
        "x-forwarded-for": "198.51.100.7, 10.42.0.5",
        "x-real-ip": "192.0.2.1",
      })
    );
    expect(ip).toBe("203.0.113.9");
  });

  it("ignores a spoofed leftmost X-Forwarded-For when Envoy set the address", () => {
    expect(
      clientIp(
        req({
          "x-envoy-external-address": "203.0.113.9",
          "x-forwarded-for": "1.2.3.4, 198.51.100.7, 10.42.0.5",
        })
      )
    ).toBe("203.0.113.9");
  });

  it("falls back to the rightmost X-Forwarded-For entry", () => {
    expect(clientIp(req({ "x-forwarded-for": "1.2.3.4, 198.51.100.7, 10.42.0.5" }))).toBe(
      "10.42.0.5"
    );
    expect(clientIp(req({ "x-forwarded-for": "  198.51.100.7  " }))).toBe("198.51.100.7");
  });

  it("prefers rightmost X-Forwarded-For over x-real-ip", () => {
    expect(
      clientIp(req({ "x-forwarded-for": "198.51.100.7", "x-real-ip": "192.0.2.1" }))
    ).toBe("198.51.100.7");
  });

  it("falls back to x-real-ip, then unknown", () => {
    expect(clientIp(req({ "x-real-ip": "192.0.2.1" }))).toBe("192.0.2.1");
    expect(clientIp(req({ "x-real-ip": "   " }))).toBe("unknown");
    expect(clientIp(req())).toBe("unknown");
  });
});

describe("takeToken", () => {
  it("allows a burst, then limits with a retry hint", () => {
    const key = "takeToken-burst";
    for (let i = 0; i < 5; i++) expect(takeToken(key, 5, 60, 0).limited).toBe(false);
    expect(takeToken(key, 5, 60, 0)).toEqual({ limited: true, retryAfterSeconds: 12 });
  });

  it("refills over the window", () => {
    const key = "takeToken-refill";
    for (let i = 0; i < 5; i++) takeToken(key, 5, 60, 0);
    expect(takeToken(key, 5, 60, 0).limited).toBe(true);
    expect(takeToken(key, 5, 60, 12_000).limited).toBe(false);
  });
});
