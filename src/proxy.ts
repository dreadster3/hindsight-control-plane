import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { localizeApiErrorPayload } from "@/lib/i18n/api-errors";
import createIntlMiddleware from "next-intl/middleware";

import { ACCESS_KEY_COOKIE, SESSION_REQUIRED_HEADER, verifySessionToken } from "@/lib/auth/session";
import { hasOidcSession, isOidcEnabled } from "@/lib/auth/oidc-config";
import { sanitizeReturnTo, stripBasePath, withBasePath } from "@/lib/base-path";
import { routing } from "@/i18n/routing";
import { maxUploadBytes } from "@/lib/upload-limit";

// Routes that don't require authentication
const PUBLIC_PATTERNS = [
  "/login",
  "/api/auth/",
  "/api/health",
  "/api/version",
  "/logo.png",
  "/favicon",
  "/_next",
  "/fonts",
  "/static",
];

const intlMiddleware = createIntlMiddleware(routing);

// next-intl rewrites /login → /en/login internally (localePrefix "never") and
// the proxy re-runs on the rewritten path. Auth checks must see the canonical
// locale-agnostic path, and the intl middleware must NOT run a second time on
// the already-rewritten path (it would redirect /en/login back to /login).
function localePrefixOf(pathname: string): string | null {
  const segment = pathname.split("/")[1];
  return (routing.locales as readonly string[]).includes(segment) ? segment : null;
}

/**
 * Valid UI session? OIDC mode checks the encrypted NextAuth session cookie
 * (decode only — token refresh happens server-side in the API routes, never
 * in the edge proxy). Access-key mode keeps the original HMAC check.
 */
async function hasValidSession(request: NextRequest, accessKey: string | undefined): Promise<boolean> {
  if (isOidcEnabled()) {
    return hasOidcSession(request, process.env.AUTH_SECRET as string);
  }
  if (!accessKey) return true;
  return verifySessionToken(request.cookies.get(ACCESS_KEY_COOKIE)?.value, accessKey);
}

export async function proxy(request: NextRequest) {
  const accessKey = process.env.HINDSIGHT_CP_ACCESS_KEY;
  const authEnabled = Boolean(accessKey) || isOidcEnabled();
  const { pathname } = request.nextUrl;
  const localePrefix = localePrefixOf(stripBasePath(pathname));
  const appPathname = localePrefix
    ? stripBasePath(pathname).slice(localePrefix.length + 1) || "/"
    : stripBasePath(pathname);

  // API routes are not locale-prefixed — handle auth directly without i18n routing.
  if (appPathname.startsWith("/api/")) {
    // Next.js would truncate a body over the limit and pass it on: refuse it instead.
    const size = Number(request.headers.get("content-length") ?? 0);
    const limit = maxUploadBytes();
    if (size > limit) {
      return NextResponse.json(
        {
          ...localizeApiErrorPayload(request, {
            error: "Request too large",
            errorKey: "api.errors.request.tooLarge",
          }),
          sizeBytes: size,
          limitBytes: limit,
        },
        { status: 413 }
      );
    }
    if (!authEnabled) {
      return NextResponse.next();
    }

    const isPublic = PUBLIC_PATTERNS.some((pattern) => appPathname.startsWith(pattern));
    if (isPublic) {
      return NextResponse.next();
    }

    const isAuthenticated = await hasValidSession(request, accessKey);

    if (!isAuthenticated) {
      return NextResponse.json(
        localizeApiErrorPayload(request, {
          error: "Unauthorized",
          errorKey: "api.errors.auth.unauthorized",
        }),
        // The header tells the browser this 401 is about its own session, so only
        // this one sends it to the login form. A 401 forwarded from the dataplane
        // can't be fixed by re-entering the UI key.
        { status: 401, headers: { [SESSION_REQUIRED_HEADER]: "1" } }
      );
    }

    return NextResponse.next();
  }

  // Page routes: enforce auth first, then delegate to the i18n middleware for
  // locale negotiation and rewriting. With localePrefix "never" the locale is
  // never in the path, so appPathname is already the canonical route.
  if (authEnabled) {
    const isPublic = PUBLIC_PATTERNS.some((pattern) => appPathname.startsWith(pattern));
    const isLogin = appPathname === "/login";

    if (!isPublic || isLogin) {
      const isAuthenticated = await hasValidSession(request, accessKey);

      if (isLogin) {
        // Already signed in: skip the login form and continue where the link pointed.
        if (isAuthenticated) {
          const target = sanitizeReturnTo(request.nextUrl.searchParams.get("returnTo"));
          return NextResponse.redirect(new URL(withBasePath(target), request.url));
        }
      } else if (!isAuthenticated) {
        // Next.js middleware redirects do not automatically inherit next.config basePath.
        // Prefix the target explicitly, but keep returnTo as the app-relative path so
        // client-side router.push() does not double-prefix after login.
        const loginUrl = new URL(withBasePath("/login"), request.url);
        loginUrl.searchParams.set("returnTo", appPathname);
        return NextResponse.redirect(loginUrl);
      }
    }
  }

  // Already locale-rewritten by a previous proxy pass: render, don't re-run
  // next-intl (with localePrefix "never" it redirects prefixed paths back).
  if (localePrefix) {
    return NextResponse.next();
  }
  return intlMiddleware(request);
}

export const config = {
  // Match all paths except Next.js internals and static assets.
  // - Use an explicit file extension allowlist instead of .*\..* so that
  //   dynamic segments containing dots (e.g. bank IDs like
  //   "SX.Products.GovComply.Build") still get the i18n locale rewrite.
  matcher:
    "/((?!_next|_vercel|.*\\.(?:png|jpe?g|gif|svg|webp|ico|css|js|map|woff2?|ttf|eot|txt|xml|json)$).*)",
};