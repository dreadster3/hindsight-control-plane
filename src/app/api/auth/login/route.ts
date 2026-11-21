import { readJsonBody } from "@/lib/body-limit";
import { NextRequest, NextResponse } from "next/server";
import { localizeApiErrorPayload } from "@/lib/i18n/api-errors";
import { clientIp, takeToken } from "@/lib/rate-limit";

import {
  ACCESS_KEY_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  sessionCookieOptions,
} from "@/lib/auth/session";

const LOGIN_ATTEMPTS_PER_MINUTE = 5;

export async function POST(request: NextRequest) {
  // A wrong key costs an attacker a bucket token, not just round-trip latency.
  const verdict = takeToken(
    `login:${clientIp(request)}`,
    LOGIN_ATTEMPTS_PER_MINUTE,
    60
  );
  if (verdict.limited) {
    return NextResponse.json(
      localizeApiErrorPayload(request, {
        error: "Too many login attempts",
        errorKey: "api.errors.auth.tooManyAttempts",
      }),
      { status: 429, headers: { "Retry-After": String(verdict.retryAfterSeconds) } }
    );
  }

  const accessKey = process.env.HINDSIGHT_CP_ACCESS_KEY;

  // If no access key is configured, return 503
  if (!accessKey) {
    return NextResponse.json(
      localizeApiErrorPayload(request, {
        error: "Access key not configured",
        errorKey: "api.errors.auth.accessKeyNotConfigured",
      }),
      { status: 503 }
    );
  }

  const parsedBody = await readJsonBody<{ key?: string }>(request);
  if (!parsedBody.ok) return parsedBody.response;
  const body = parsedBody.body;

  const providedKey = body.key;

  // Constant-time comparison to prevent timing attacks
  const isValid = providedKey && constantTimeCompare(providedKey, accessKey);

  if (!isValid) {
    return NextResponse.json(
      localizeApiErrorPayload(request, {
        error: "Invalid access key",
        errorKey: "api.errors.auth.invalidAccessKey",
      }),
      { status: 401 }
    );
  }

  const response = NextResponse.json({ success: true });

  response.cookies.set({
    name: ACCESS_KEY_COOKIE,
    value: await createSessionToken(accessKey),
    ...sessionCookieOptions(request),
    maxAge: SESSION_MAX_AGE_SECONDS,
  });

  return response;
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}
