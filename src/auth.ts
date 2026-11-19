/**
 * NextAuth (Auth.js v5) setup — Authentik OIDC login for the control plane.
 *
 * The user's IdP access/refresh tokens are stored in the encrypted, HttpOnly
 * session JWT (JWE cookie) and are NEVER exposed to the browser session: the
 * `session` callback only forwards identity. API routes read the access token
 * server-side via `dataplaneToken()` and forward it to the Hindsight API,
 * whose hybrid-tenant extension resolves it to the user's own schema — so the
 * banks a user sees are exactly the banks in their schema.
 *
 * Provider credentials are inferred from the standard env vars:
 * AUTH_AUTHENTIK_ID, AUTH_AUTHENTIK_SECRET, AUTH_AUTHENTIK_ISSUER, AUTH_SECRET.
 */
import NextAuth from "next-auth";
import Authentik from "next-auth/providers/authentik";
import type { DefaultSession } from "next-auth";

import { isOidcEnabled } from "@/lib/auth/oidc-config";

declare module "next-auth" {
  interface Session {
    user: {
      /** IdP username (preferred_username claim) — identity only, no tokens. */
      username?: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    access_token?: string;
    refresh_token?: string;
    /** Unix seconds — when the IdP access token expires. */
    expires_at?: number;
    preferred_username?: string;
  }
}

/**
 * Authentik issues no refresh_token unless `offline_access` is requested.
 * An explicit scope replaces @auth/core's `openid profile email` default, so
 * both must be one string.
 */
const AUTHENTIK_SCOPE = "openid profile email offline_access";

export const authentikProvider = Authentik({
  authorization: { params: { scope: AUTHENTIK_SCOPE } },
});

export const { handlers, signIn, auth } = NextAuth({
  providers: isOidcEnabled() ? [authentikProvider] : [],
  session: { strategy: "jwt" },
  callbacks: {
    jwt({ token, account, profile }) {
      // Sign-in: persist the IdP tokens in the encrypted session cookie.
      // Refresh rotation happens server-side in dataplaneToken(), not here,
      // so the edge proxy never needs to refresh.
      if (account) {
        token.access_token = account.access_token;
        token.refresh_token = account.refresh_token;
        token.expires_at = account.expires_at;
      }
      if (profile?.preferred_username) {
        token.preferred_username = profile.preferred_username as string;
      }
      return token;
    },
    session({ session, token }) {
      // Identity only — access/refresh tokens must never reach the browser.
      if (token.preferred_username) {
        session.user.username = token.preferred_username;
      }
      return session;
    },
  },
});