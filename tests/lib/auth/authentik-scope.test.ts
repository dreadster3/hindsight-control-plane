import { describe, expect, it, vi } from "vitest";

import { authentikProvider } from "@/auth";

// next-auth's root module imports extensionless `next/server`, which Vitest
// cannot resolve; the provider config under test does not use it.
vi.mock("next-auth", () => ({
  default: () => ({ handlers: {}, signIn: vi.fn(), auth: vi.fn() }),
}));

describe("Authentik provider authorization scope", () => {
  it("requests offline_access without dropping the default OIDC scopes", () => {
    const scope: string | undefined =
      authentikProvider.options?.authorization?.params?.scope;
    const scopes = scope?.split(" ") ?? [];
    expect(scopes).toContain("offline_access");
    expect(scopes).toEqual(expect.arrayContaining(["openid", "profile", "email"]));
  });
});
