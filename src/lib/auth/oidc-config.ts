/**
 * OIDC mode detection and session-cookie helpers — edge-safe (no next/headers),
 * shared by the proxy and the Node-only dataplane-token helper.
 *
 * OIDC mode is enabled when the Authentik provider AND the session secret are
 * configured. Otherwise the control plane keeps its original behavior
 * (HINDSIGHT_CP_ACCESS_KEY gate + shared dataplane API key).
 */
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

import { isSecureRequest } from "./session";

export function isOidcEnabled(): boolean {
  return Boolean(
    process.env.AUTH_AUTHENTIK_ISSUER &&
      process.env.AUTH_AUTHENTIK_ID &&
      process.env.AUTH_AUTHENTIK_SECRET &&
      process.env.AUTH_SECRET
  );
}

/** NextAuth v5 default session cookie names (see @auth/core defaultCookies). */
export function oidcSessionCookieName(secure: boolean): string {
  return `${secure ? "__Secure-" : ""}authjs.session-token`;
}

/**
 * Find the raw session JWE under either cookie-name variant. The control plane
 * derives "secure" from X-Forwarded-Proto while NextAuth derives it from its own
 * trustHost/protocol view; if a deployment makes them disagree, the session
 * must still be found under the name NextAuth actually set.
 */
export async function findSessionCookie(
  request: NextRequest,
  secret: string
): Promise<{ raw: string; cookieName: string } | null> {
  const secure = isSecureRequest(request);
  for (const variant of [secure, !secure]) {
    const cookieName = oidcSessionCookieName(variant);
    const raw = await getToken({ req: request, secret, cookieName, raw: true });
    if (raw) return { raw, cookieName };
  }
  return null;
}

/** Valid (decryptable) OIDC session present? Decode only — never refreshes. */
export async function hasOidcSession(request: NextRequest, secret: string): Promise<boolean> {
  const secure = isSecureRequest(request);
  for (const variant of [secure, !secure]) {
    const token = await getToken({
      req: request,
      secret,
      cookieName: oidcSessionCookieName(variant),
    });
    if (token) return true;
  }
  return false;
}