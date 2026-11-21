import { requireSession } from "@/lib/auth/require-session";
import { NextRequest, NextResponse } from "next/server";
import { localizeApiErrorPayload } from "@/lib/i18n/api-errors";
import { dataplaneBankUrl, getDataplaneHeaders } from "@/lib/hindsight-client";
import { dataplaneToken } from "@/lib/auth/dataplane-token";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ bankId: string; modelId: string }> }
) {
  const denied = await requireSession(request);
  if (denied) return denied;

  const token = await dataplaneToken(request);
  try {
    const { bankId, modelId } = await params;

    if (!bankId || !modelId) {
      return NextResponse.json(
        localizeApiErrorPayload(request, {
          error: "bank_id and model_id are required",
          errorKey: "api.errors.validation.bankAndModelIdRequired",
        }),
        { status: 400 }
      );
    }

    const response = await fetch(
      dataplaneBankUrl(bankId, `/memories/${encodeURIComponent(modelId)}`),
      { method: "GET", headers: getDataplaneHeaders(token) }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("API error getting observation:", errorText);
      return NextResponse.json(
        localizeApiErrorPayload(request, {
          error: "Failed to get observation",
          errorKey: "api.errors.observations.fetch",
        }),
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    console.error("Error getting observation:", error);
    return NextResponse.json(
      localizeApiErrorPayload(request, {
        error: "Failed to get observation",
        errorKey: "api.errors.observations.fetch",
      }),
      { status: 500 }
    );
  }
}
