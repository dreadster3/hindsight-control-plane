import { NextRequest, NextResponse } from "next/server";

import { ACCESS_KEY_COOKIE, sessionCookieOptions } from "@/lib/auth/session";
import { isOidcEnabled, oidcSessionCookieName } from "@/lib/auth/oidc-config";

export async function POST(request: NextRequest) {
  const response = NextResponse.json({ success: true });

  response.cookies.set({
    name: ACCESS_KEY_COOKIE,
    value: "",
    ...sessionCookieOptions(request),
    maxAge: 0,
  });

  if (isOidcEnabled()) {
    // Clear the NextAuth session cookie, including any size-chunks. Both name
    // variants so a proxied https→http switch can't leave a stale session.
    for (const secure of [false, true]) {
      const name = oidcSessionCookieName(secure);
      for (const cookie of request.cookies.getAll()) {
        if (cookie.name === name || cookie.name.startsWith(`${name}.`)) {
          response.cookies.set({
            name: cookie.name,
            value: "",
            ...sessionCookieOptions(request),
            maxAge: 0,
          });
        }
      }
    }
  }

  return response;
}