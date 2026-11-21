import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { listBanks } = vi.hoisted(() => ({ listBanks: vi.fn() }));

vi.mock("@vectorize-io/hindsight-client", () => ({
  createClient: vi.fn(() => ({})),
  createConfig: vi.fn((config: unknown) => config),
  sdk: { listBanks },
}));
vi.mock("@/lib/hindsight-client", () => ({ getDataplaneHeaders: () => ({}) }));
vi.mock("@/lib/auth/dataplane-token", () => ({
  dataplaneToken: vi.fn(async () => "test-token"),
}));

import { GET } from "@/app/api/health/route";
import { ACCESS_KEY_COOKIE, createSessionToken } from "@/lib/auth/session";

const ACCESS_KEY = "test-access-key";

async function health(withSession: boolean) {
  const request = new NextRequest("http://localhost/api/health");
  if (withSession) {
    request.cookies.set(ACCESS_KEY_COOKIE, await createSessionToken(ACCESS_KEY));
  }
  return GET(request);
}

beforeEach(() => {
  listBanks.mockReset();
  listBanks.mockResolvedValue({ data: { banks: [], total: 0 } });
});

afterEach(() => vi.unstubAllEnvs());

describe("GET /api/health", () => {
  it("tells anonymous callers only that a session is required", async () => {
    vi.stubEnv("HINDSIGHT_CP_ACCESS_KEY", ACCESS_KEY);
    vi.stubEnv("HINDSIGHT_CP_DATAPLANE_API_URL", "http://hindsight-api:8888");

    const response = await health(false);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      status: "ok",
      service: "hindsight-control-plane",
      dataplane: { status: "auth-required" },
    });
    expect(JSON.stringify(body)).not.toContain("hindsight-api");
    expect(listBanks).not.toHaveBeenCalled();
  });

  it("keeps the dataplane details for an authenticated caller", async () => {
    vi.stubEnv("HINDSIGHT_CP_ACCESS_KEY", ACCESS_KEY);
    vi.stubEnv("HINDSIGHT_CP_DATAPLANE_API_URL", "http://hindsight-api:8888");

    const body = await (await health(true)).json();

    expect(body.dataplane).toEqual({ status: "connected", url: "http://hindsight-api:8888" });
  });

  it("reports a disconnected dataplane to an authenticated caller", async () => {
    vi.stubEnv("HINDSIGHT_CP_ACCESS_KEY", ACCESS_KEY);
    listBanks.mockRejectedValue(new Error("ECONNREFUSED"));

    const body = await (await health(true)).json();

    expect(body.dataplane.status).toBe("disconnected");
    expect(body.dataplane.error).toContain("ECONNREFUSED");
  });
});
