import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { localizeApiErrorPayload } from "@/lib/i18n/api-errors";
import createIntlMiddleware from "next-intl/middleware";

import { ACCESS_KEY_COOKIE, SESSION_REQUIRED_HEADER, verifySessionToken } from "@/lib/auth/session";
import { hasOidcSession, isOidcEnabled } from "@/lib/auth/oidc-config";
import { sanitizeReturnTo, stripBasePath, withBasePath } from "@/lib/base-path";
import { routing } from "@/i18n/routing";
import { maxUploadBytes } from "@/lib/upload-limit";

// Routes that don't require authentication. Matched on path boundaries (see
// isPublicPath): a bare startsWith would also make "/api/healthz" public.
const PUBLIC_PATTERNS = [
  "/login",
  "/api/auth",
  "/api/health",
  "/api/version",
  "/logo.png",
  "/favicon",
  "/_next",
  "/fonts",
  "/static",
];

const intlMiddleware = createIntlMiddleware(routing);

/** Public only on an exact match or a "/"-separated child of the pattern. */
function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATTERNS.some(
    (pattern) => pathname === pattern || pathname.startsWith(`${pattern}/`)
  );
}

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

/**
 * Nonce-based CSP. Shipped Report-Only: the UI pass in the release checklist
 * enforces it once no violations are left. Next.js picks the nonce up from the
 * request's Content-Security-Policy header and stamps its inline bootstrap
 * scripts with it. style-src keeps 'unsafe-inline' and no nonce (a nonce there
 * would cancel 'unsafe-inline'), because React and Radix emit style attributes.
 */
function contentSecurityPolicy(nonce: string): string {
  const isDev = process.env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

/** NextResponse.next() that hands the nonce and policy to the render. */
function passThrough(request: NextRequest, nonce: string, csp: string): NextResponse {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export async function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = contentSecurityPolicy(nonce);
  const response = await handleRequest(request, nonce, csp);
  response.headers.set("Content-Security-Policy-Report-Only", csp);
  return response;
}

async function handleRequest(request: NextRequest, nonce: string, csp: string) {
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
      return passThrough(request, nonce, csp);
    }

    if (isPublicPath(appPathname)) {
      return passThrough(request, nonce, csp);
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

    return passThrough(request, nonce, csp);
  }

  // Page routes: enforce auth first, then delegate to the i18n middleware for
  // locale negotiation and rewriting. With localePrefix "never" the locale is
  // never in the path, so appPathname is already the canonical route.
  if (authEnabled) {
    const isLogin = appPathname === "/login";

    if (!isPublicPath(appPathname) || isLogin) {
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
    return passThrough(request, nonce, csp);
  }
  return intlMiddleware(request);
}

export const config = {
  matcher: [
    // Every API route, whatever its last segment looks like: a bank id or alias
    // may end in ".json" or ".js" and must not skip the access check.
    "/api/:path*",
    // Pages, minus Next.js internals and root-level static assets. Only the
    // root-level form is excluded so dynamic segments containing dots (e.g.
    // bank IDs like "SX.Products.GovComply.Build") still get the i18n rewrite.
    "/((?!_next|_vercel|img/|fonts/|[^/]+\\.(?:png|jpe?g|gif|svg|webp|ico|css|js|map|woff2?|ttf|eot|txt|xml|json)$).*)",
  ],
};
