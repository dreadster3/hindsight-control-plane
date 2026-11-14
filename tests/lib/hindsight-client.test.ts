import { describe, expect, it, vi } from "vitest";
import { afterEach } from "vitest";
import { HindsightClient } from "@vectorize-io/hindsight-client";
import {
  USER_AGENT,
  getDataplaneHeaders,
  hindsightClientFor,
  lowLevelClientFor,
} from "@/lib/hindsight-client";
import { version } from "../../package.json";

describe("dataplane User-Agent", () => {
  it("identifies the control plane and its version", () => {
    expect(USER_AGENT).toBe(`hindsight-control-plane/${version}`);
  });

  it("is sent on direct fetches and by the low-level client", () => {
    expect(getDataplaneHeaders("tok", { "Content-Type": "application/json" })).toMatchObject({
      "User-Agent": USER_AGENT,
      "Content-Type": "application/json",
    });
    const headers = lowLevelClientFor("tok").getConfig().headers as Headers;
    expect(headers.get("User-Agent")).toBe(USER_AGENT);
  });
});

describe("dataplane credentials", () => {
  it("sends the caller's token as a bearer", () => {
    expect(getDataplaneHeaders("tok").Authorization).toBe("Bearer tok");
    const headers = lowLevelClientFor("tok").getConfig().headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer tok");
  });

  it("sends no Authorization at all when the caller has no token", () => {
    expect(getDataplaneHeaders(null)).not.toHaveProperty("Authorization");
  });

  it("keeps extra headers alongside the bearer", () => {
    expect(getDataplaneHeaders("tok", { "Content-Type": "application/json" })).toEqual({
      "User-Agent": USER_AGENT,
      Authorization: "Bearer tok",
      "Content-Type": "application/json",
    });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("falls back to the shared API key when no token is passed (access-key mode)", async () => {
    vi.resetModules();
    vi.stubEnv("HINDSIGHT_CP_DATAPLANE_API_KEY", "env-key");
    const mod = await import("@/lib/hindsight-client");

    expect(mod.getDataplaneHeaders().Authorization).toBe("Bearer env-key");
    const headers = mod.lowLevelClientFor().getConfig().headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer env-key");
  });
});

describe("hindsightClientFor", () => {
  it("builds a HindsightClient scoped to the caller's token", () => {
    expect(hindsightClientFor("tok")).toBeInstanceOf(HindsightClient);
  });
});
