import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { localizeApiErrorPayload } from "@/lib/i18n/api-errors";
import { sdk, lowLevelClientFor } from "@/lib/hindsight-client";
import { dataplaneToken } from "@/lib/auth/dataplane-token";
import { isOidcEnabled } from "@/lib/auth/oidc-config";

export async function GET(request: NextRequest) {
  try {
    const token = await dataplaneToken(request);
    if (isOidcEnabled() && token === null) {
      // Public endpoint: report control-plane features without a dataplane
      // round-trip (which would 401 for anonymous callers in OIDC mode).
      return NextResponse.json(
        {
          features: {
            access_key_auth: !!process.env.HINDSIGHT_CP_ACCESS_KEY,
            oidc_auth: true,
          },
        },
        { status: 200 }
      );
    }
    const response = await sdk.getVersion({
      client: lowLevelClientFor(token),
    });

    if (response.error) {
      console.error("API error getting version:", response.error);
      return NextResponse.json(
        localizeApiErrorPayload(request, {
          error: "Failed to get version",
          errorKey: "api.errors.version.fetch",
        }),
        { status: 500 }
      );
    }

    const data = response.data as Record<string, unknown>;
    const features = (data.features ?? {}) as Record<string, boolean>;
    features.access_key_auth = !!process.env.HINDSIGHT_CP_ACCESS_KEY;
    features.oidc_auth = isOidcEnabled();
    data.features = features;

    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    console.error("Error getting version:", error);
    return NextResponse.json(
      localizeApiErrorPayload(request, {
        error: "Failed to get version",
        errorKey: "api.errors.version.fetch",
      }),
      { status: 500 }
    );
  }
}
