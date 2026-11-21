import { NextRequest, NextResponse } from "next/server";

import { hasOidcSession, isOidcEnabled } from "./oidc-config";
import { ACCESS_KEY_COOKIE, SESSION_REQUIRED_HEADER, verifySessionToken } from "./session";

/**
 * Returns a 401 response when the caller has no valid UI session; null when OK.
 *
 * The proxy gate is an optimization, not the security boundary: a matcher
 * regression or a Next internal rewrite can skip it, and in access-key mode a
 * skipped gate means the handler talks to the dataplane on the shared key. So
 * every non-public route handler calls this first, before it reads a body or
 * touches the dataplane.
 */
export async function requireSession(request: NextRequest): Promise<NextResponse | null> {
  const accessKey = process.env.HINDSIGHT_CP_ACCESS_KEY;
  const ok = isOidcEnabled()
    ? await hasOidcSession(request, process.env.AUTH_SECRET as string)
    : !accessKey || (await verifySessionToken(request.cookies.get(ACCESS_KEY_COOKIE)?.value, accessKey));
  if (ok) return null;
  return NextResponse.json(
    { error: "Unauthorized", errorKey: "api.errors.auth.unauthorized" },
    { status: 401, headers: { [SESSION_REQUIRED_HEADER]: "1" } }
  );
}
