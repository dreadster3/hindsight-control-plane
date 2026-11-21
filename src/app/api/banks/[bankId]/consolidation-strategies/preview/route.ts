import { bodyTooLarge, jsonBodyLimit, readTextLimited } from "@/lib/body-limit";
import { requireSession } from "@/lib/auth/require-session";
import { NextRequest, NextResponse } from "next/server";
import { localizeApiErrorPayload } from "@/lib/i18n/api-errors";
import { DATAPLANE_URL, getDataplaneHeaders } from "@/lib/hindsight-client";
import { dataplaneToken } from "@/lib/auth/dataplane-token";

/** Proxies POST /v1/default/banks/{bank_id}/consolidation-strategies/preview — the
 *  strategy editor's "which existing scopes does this rule match" summary. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ bankId: string }> }
) {
  const denied = await requireSession(request);
  if (denied) return denied;

  const token = await dataplaneToken(request);
  try {
    const { bankId } = await params;

    if (!bankId) {
      return NextResponse.json(
        localizeApiErrorPayload(request, {
          error: "bank_id is required",
          errorKey: "api.errors.validation.bankIdRequired",
        }),
        { status: 400 }
      );
    }

    let body: string;
    try {
      body = await readTextLimited(request);
    } catch (error) {
      if (error instanceof RangeError) return bodyTooLarge(jsonBodyLimit());
      throw error;
    }
    const response = await fetch(
      `${DATAPLANE_URL}/v1/default/banks/${bankId}/consolidation-strategies/preview`,
      {
        method: "POST",
        headers: getDataplaneHeaders(token, { "Content-Type": "application/json" }),
        body,
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }));
      return NextResponse.json(error, { status: response.status });
    }

    return NextResponse.json(await response.json(), { status: 200 });
  } catch (error) {
    console.error("Error previewing consolidation strategies:", error);
    return NextResponse.json(
      localizeApiErrorPayload(request, {
        error: "Failed to preview consolidation strategies",
        errorKey: "api.errors.consolidation.previewStrategies",
      }),
      { status: 500 }
    );
  }
}
