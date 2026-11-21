import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ListBanksArg = { query: Record<string, unknown> };

const { listBanks, lowLevelClientFor } = vi.hoisted(() => ({
  listBanks: vi.fn<(arg: ListBanksArg) => Promise<unknown>>(),
  lowLevelClientFor: vi.fn(() => ({})),
}));

vi.mock("@/lib/hindsight-client", () => ({
  sdk: { listBanks },
  lowLevelClientFor,
}));
vi.mock("@/lib/auth/dataplane-token", () => ({
  dataplaneToken: vi.fn(async () => "test-token"),
}));

vi.mock("@/lib/sdk-response", () => ({
  respondWithSdk: vi.fn(() => new Response(null, { status: 200 })),
}));

import { GET } from "@/app/api/banks/route";

function makeRequest(url: string): NextRequest {
  return new NextRequest(url);
}

describe("GET /api/banks", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("refuses a caller with no session, even with the proxy out of the way (CP-2)", async () => {
    vi.stubEnv("HINDSIGHT_CP_ACCESS_KEY", "test-access-key");
    const res = await GET(makeRequest("http://localhost/api/banks"));
    expect(res.status).toBe(401);
    expect(res.headers.get("x-hindsight-session-required")).toBe("1");
    expect(listBanks).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    listBanks.mockReset();
    listBanks.mockResolvedValue({
      data: { banks: [], total: 0, limit: 50, offset: 0 },
      error: undefined,
    });
  });

  it("forwards the search term and the paging window to the dataplane", async () => {
    await GET(makeRequest("http://localhost/api/banks?q=alice&limit=50&offset=100"));

    expect(listBanks).toHaveBeenCalledTimes(1);
    expect(listBanks.mock.calls[0][0].query).toMatchObject({ q: "alice", limit: 50, offset: 100 });
    expect(lowLevelClientFor).toHaveBeenCalledWith("test-token");
  });

  it("sends offset=0 rather than dropping it (the first page is explicit)", async () => {
    await GET(makeRequest("http://localhost/api/banks?limit=50&offset=0"));

    expect(listBanks.mock.calls[0][0].query).toMatchObject({ limit: 50, offset: 0 });
  });

  it("omits every param when none are provided, so the dataplane defaults apply", async () => {
    await GET(makeRequest("http://localhost/api/banks"));

    expect(listBanks.mock.calls[0][0].query).toEqual({});
  });
});
