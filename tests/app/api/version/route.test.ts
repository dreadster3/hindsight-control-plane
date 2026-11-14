import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/dataplane-token", () => ({ dataplaneToken: vi.fn(async () => null) }));
vi.mock("@/lib/hindsight-client", () => ({
  DATAPLANE_URL: "http://dataplane.test",
  getDataplaneHeaders: vi.fn((token?: string | null) =>
    token ? { Authorization: `Bearer ${token}` } : {}
  ),
}));

import { GET } from "@/app/api/version/route";
import { dataplaneToken } from "@/lib/auth/dataplane-token";

const req = () => new NextRequest(new URL("/api/version", "http://localhost:9999"));

function stubOidc() {
  vi.stubEnv("AUTH_SECRET", "test-secret");
  vi.stubEnv("AUTH_AUTHENTIK_ISSUER", "https://authentik.example/application/o/hindsight");
  vi.stubEnv("AUTH_AUTHENTIK_ID", "client-id");
  vi.stubEnv("AUTH_AUTHENTIK_SECRET", "client-secret");
}

describe("GET /api/version", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.mocked(dataplaneToken).mockResolvedValue(null);
  });

  it("reports features to anonymous OIDC callers without a dataplane round-trip", async () => {
    stubOidc();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect((await res.json()).features.oidc_auth).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("merges dataplane features from /v1/version with control-plane features", async () => {
    stubOidc();
    vi.mocked(dataplaneToken).mockResolvedValue("user-token");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(url).toBe("http://dataplane.test/v1/version");
        return {
          ok: true,
          json: async () => ({ api_version: "1.2.1", features: { observations: true } }),
        };
      })
    );
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.api_version).toBe("1.2.1");
    expect(body.features).toMatchObject({ observations: true, oidc_auth: true });
  });

  it("degrades to control-plane features when the dataplane lacks the endpoint", async () => {
    stubOidc();
    vi.mocked(dataplaneToken).mockResolvedValue("user-token");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404 })));
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect((await res.json()).features.oidc_auth).toBe(true);
  });

  it("degrades to control-plane features when the dataplane is unreachable", async () => {
    stubOidc();
    vi.mocked(dataplaneToken).mockResolvedValue("user-token");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("fetch failed"); }));
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect((await res.json()).features.oidc_auth).toBe(true);
  });
});