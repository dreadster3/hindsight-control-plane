import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

const { resolveBindHost, resolveBindTarget } = createRequire(import.meta.url)("../../bin/cli.js");

const IMAGE_ENV = { PORT: "9999", HOSTNAME: "0.0.0.0" };

describe("cli resolveBindTarget", () => {
  it("defaults to 9999 on 0.0.0.0 when nothing is set", () => {
    expect(resolveBindTarget({})).toEqual({ port: 9999, hostname: "0.0.0.0" });
  });

  it("reads the bare PORT/HOSTNAME fallbacks", () => {
    expect(resolveBindTarget({ PORT: "3000", HOSTNAME: "127.0.0.1" })).toEqual({
      port: "3000",
      hostname: "127.0.0.1",
    });
  });

  it("lets HINDSIGHT_CP_* beat the bare names", () => {
    expect(
      resolveBindTarget({
        ...IMAGE_ENV,
        HINDSIGHT_CP_PORT: "3001",
        HINDSIGHT_CP_HOSTNAME: "127.0.0.1",
      })
    ).toEqual({ port: "3001", hostname: "127.0.0.1" });
  });

  it("applies the loopback translation to an aliased hostname", () => {
    const { hostname } = resolveBindTarget({ HINDSIGHT_CP_HOSTNAME: "::1" });
    expect(resolveBindHost(hostname, undefined)).toEqual({
      hostname: "localhost",
      nodeOptions: "--dns-result-order=ipv6first",
    });
  });
});

describe("cli resolveBindHost (#1926)", () => {
  it("binds a loopback literal as localhost, keeping the requested family", () => {
    expect(resolveBindHost("127.0.0.1", undefined)).toEqual({
      hostname: "localhost",
      nodeOptions: "--dns-result-order=ipv4first",
    });
    for (const v6 of ["::1", "[::1]"]) {
      expect(resolveBindHost(v6, "")).toEqual({
        hostname: "localhost",
        nodeOptions: "--dns-result-order=ipv6first",
      });
    }
  });

  it("appends to an operator's NODE_OPTIONS instead of replacing it", () => {
    expect(resolveBindHost("127.0.0.1", "--max-old-space-size=2048").nodeOptions).toBe(
      "--max-old-space-size=2048 --dns-result-order=ipv4first"
    );
  });

  it("leaves every other hostname and NODE_OPTIONS untouched", () => {
    for (const host of ["0.0.0.0", "localhost", "cp.internal"]) {
      expect(resolveBindHost(host, "--foo")).toEqual({ hostname: host, nodeOptions: "--foo" });
    }
  });
});
