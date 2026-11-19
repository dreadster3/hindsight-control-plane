import { describe, expect, it, vi } from "vitest";

import parseProviders from "../../../node_modules/@auth/core/lib/utils/providers.js";
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

  it("keeps offline_access through @auth/core normalization", () => {
    // @auth/core normalizes authorization params into authorization.url's
    // searchParams; that URL is what getAuthorizationUrl sends to the IdP.
    const { provider } = parseProviders({
      url: new URL("http://localhost:9999/api/auth"),
      providerId: "authentik",
      config: { providers: [authentikProvider] } as never,
    });
    expect(provider?.authorization?.url.searchParams.get("scope")).toBe(
      "openid profile email offline_access"
    );
  });
});
