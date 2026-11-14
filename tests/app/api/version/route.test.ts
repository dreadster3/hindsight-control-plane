import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/dataplane-token", () => ({ dataplaneToken: vi.fn(async () => null) }));
vi.mock("@/lib/hindsight-client", () => ({
  sdk: { getVersion: vi.fn() },
  lowLevelClientFor: vi.fn(() => ({})),
}));

import { GET } from "@/app/api/version/route";

describe("GET /api/version (OIDC mode)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reports features to anonymous callers instead of erroring on the dataplane", async () => {
    vi.stubEnv("AUTH_SECRET", "test-secret");
    vi.stubEnv("AUTH_AUTHENTIK_ISSUER", "https://authentik.example/application/o/hindsight");
    vi.stubEnv("AUTH_AUTHENTIK_ID", "client-id");
    vi.stubEnv("AUTH_AUTHENTIK_SECRET", "client-secret");

    const res = await GET(new NextRequest(new URL("/api/version", "http://localhost:9999")));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.features.oidc_auth).toBe(true);
  });
});