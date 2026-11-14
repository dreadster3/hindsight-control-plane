import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { DATAPLANE_URL, getDataplaneHeaders } from "@/lib/hindsight-client";
import { dataplaneToken } from "@/lib/auth/dataplane-token";
import { isOidcEnabled } from "@/lib/auth/oidc-config";

function controlPlaneFeatures() {
  return {
    access_key_auth: !!process.env.HINDSIGHT_CP_ACCESS_KEY,
    oidc_auth: isOidcEnabled(),
  };
}

export async function GET(request: NextRequest) {
  const token = await dataplaneToken(request);
  if (isOidcEnabled() && token === null) {
    // Public endpoint: report control-plane features without a dataplane
    // round-trip (which would 401 for anonymous callers in OIDC mode).
    return NextResponse.json({ features: controlPlaneFeatures() }, { status: 200 });
  }

  // /v1/version exists on both older deployments and current upstream (the
  // SDK's /version path only exists on newer APIs). The UI merges these with
  // its own defaults, so a dataplane without the endpoint must not 500.
  let data: Record<string, unknown> = {};
  try {
    const res = await fetch(`${DATAPLANE_URL}/v1/version`, {
      headers: getDataplaneHeaders(token),
    });
    if (res.ok) {
      data = (await res.json()) as Record<string, unknown>;
    } else {
      console.warn(`[Control Plane] Dataplane version probe returned ${res.status}; reporting control-plane features only`);
    }
  } catch (error) {
    console.warn(
      "[Control Plane] Dataplane version probe failed:",
      error instanceof Error ? error.message : String(error)
    );
  }

  const features = (data.features ?? {}) as Record<string, boolean>;
  data.features = { ...features, ...controlPlaneFeatures() };
  return NextResponse.json(data, { status: 200 });
}