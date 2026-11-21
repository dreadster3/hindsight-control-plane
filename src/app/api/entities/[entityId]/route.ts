import { requireSession } from "@/lib/auth/require-session";
import { NextRequest, NextResponse } from "next/server";
import { localizeApiErrorPayload } from "@/lib/i18n/api-errors";
import { sdk, lowLevelClientFor } from "@/lib/hindsight-client";
import { dataplaneToken } from "@/lib/auth/dataplane-token";
import { respondWithSdk } from "@/lib/sdk-response";
import { readTagFilter } from "@/lib/tag-filter-params";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ entityId: string }> }
) {
  const denied = await requireSession(request);
  if (denied) return denied;

  const token = await dataplaneToken(request);
  const { entityId } = await params;
  const searchParams = request.nextUrl.searchParams;
  const bankId = searchParams.get("bank_id");

  if (!bankId) {
    return NextResponse.json(
      localizeApiErrorPayload(request, {
        error: "bank_id is required",
        errorKey: "api.errors.validation.bankIdRequired",
      }),
      { status: 400 }
    );
  }

  // Decode URL-encoded entityId in case it contains special chars
  const decodedEntityId = decodeURIComponent(entityId);

  const response = await sdk.getEntity({
    client: lowLevelClientFor(token),
    path: {
      bank_id: bankId,
      entity_id: decodedEntityId,
    },
    query: readTagFilter(searchParams),
  });
  return respondWithSdk(response, "Failed to get entity", { request });
}
