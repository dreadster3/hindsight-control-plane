/**
 * Shared Hindsight API client factories for the control plane.
 * Configured to connect to the dataplane API server.
 *
 * Credentials are per-request: in OIDC mode each caller passes the logged-in
 * user's IdP access token (see `dataplaneToken()`), so the dataplane scopes
 * every call to that user. Passing `undefined` falls back to the shared
 * HINDSIGHT_CP_DATAPLANE_API_KEY (access-key mode); `null` sends no auth.
 */

import {
  HindsightClient,
  HindsightError,
  createClient,
  createConfig,
  sdk,
} from "@vectorize-io/hindsight-client";
import { version } from "../../package.json";

export const DATAPLANE_URL = process.env.HINDSIGHT_CP_DATAPLANE_API_URL || "http://localhost:8888";
const DATAPLANE_API_KEY = process.env.HINDSIGHT_CP_DATAPLANE_API_KEY || "";

/** Sent on every dataplane request so the API can tell control-plane traffic apart. */
export const USER_AGENT = `hindsight-control-plane/${version}`;

/**
 * Auth headers for direct fetch calls to the dataplane API.
 */
export function getDataplaneHeaders(
  token?: string | null,
  extra?: Record<string, string>
): Record<string, string> {
  const headers: Record<string, string> = { "User-Agent": USER_AGENT, ...extra };
  const key = token === undefined ? DATAPLANE_API_KEY : token;
  if (key) {
    headers["Authorization"] = `Bearer ${key}`;
  }
  return headers;
}

/**
 * Build a dataplane URL for a bank-scoped endpoint with the bank id properly encoded.
 * Bank ids may contain `:`, `/`, `%`, etc. (e.g. openclaw `agent::channel::user`),
 * which must be percent-encoded before being interpolated into a URL path.
 */
export function dataplaneBankUrl(bankId: string, suffix = ""): string {
  return `${DATAPLANE_URL}/v1/default/banks/${encodeURIComponent(bankId)}${suffix}`;
}

/**
 * High-level client with convenience methods, scoped to one caller's token.
 */
export function hindsightClientFor(token?: string | null): HindsightClient {
  const key = token === undefined ? DATAPLANE_API_KEY : token;
  return new HindsightClient({
    baseUrl: DATAPLANE_URL,
    apiKey: key || undefined,
    userAgent: USER_AGENT,
  });
}

/**
 * Low-level client for direct SDK access, scoped to one caller's token.
 */
export function lowLevelClientFor(token?: string | null) {
  return createClient(
    createConfig({
      baseUrl: DATAPLANE_URL,
      headers: getDataplaneHeaders(token),
    })
  );
}

/**
 * Export SDK functions for direct API access
 */
export { sdk };

/**
 * Export HindsightError for error handling
 */
export { HindsightError };
