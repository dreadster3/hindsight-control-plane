import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createClient, createConfig, sdk } from "@vectorize-io/hindsight-client";
import { getDataplaneHeaders } from "@/lib/hindsight-client";
import { dataplaneToken } from "@/lib/auth/dataplane-token";
import { isOidcEnabled } from "@/lib/auth/oidc-config";

const HEALTH_CHECK_TIMEOUT_MS = 3000;

export async function GET(request: NextRequest) {
  const status: {
    status: string;
    service: string;
    dataplane?: {
      status: string;
      url: string;
      error?: string;
    };
  } = {
    status: "ok",
    service: "hindsight-control-plane",
  };

  // Check dataplane connectivity with a short timeout
  const dataplaneUrl = process.env.HINDSIGHT_CP_DATAPLANE_API_URL || "http://localhost:8888";
  const token = await dataplaneToken(request);
  if (isOidcEnabled() && token === null) {
    // Public endpoint, but the probe needs a user session in OIDC mode.
    // Report that honestly instead of probing unauthenticated and calling a
    // 401 "disconnected".
    return NextResponse.json(
      { ...status, dataplane: { status: "auth-required", url: dataplaneUrl } },
      { status: 200 }
    );
  }
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);

    const healthClient = createClient(
      createConfig({
        baseUrl: dataplaneUrl,
        signal: controller.signal,
        headers: getDataplaneHeaders(token),
      })
    );

    try {
      // A reachability probe, not a listing: ask for the smallest page the
      // endpoint will serve instead of pulling the default 100 banks.
      await sdk.listBanks({ client: healthClient, query: { limit: 1 } });
      status.dataplane = {
        status: "connected",
        url: dataplaneUrl,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error) {
    let errorMessage = error instanceof Error ? error.message : String(error);
    if (error instanceof Error && error.name === "AbortError") {
      errorMessage = `Request timed out after ${HEALTH_CHECK_TIMEOUT_MS}ms`;
    }
    status.dataplane = {
      status: "disconnected",
      url: dataplaneUrl,
      error: errorMessage,
    };
  }

  return NextResponse.json(status, { status: 200 });
}
