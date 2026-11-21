import { requireSession } from "@/lib/auth/require-session";
import { NextRequest, NextResponse } from "next/server";
import { localizeApiErrorPayload } from "@/lib/i18n/api-errors";
import { sdk, lowLevelClientFor } from "@/lib/hindsight-client";
import { dataplaneToken } from "@/lib/auth/dataplane-token";
import { respondWithSdk } from "@/lib/sdk-response";
import { readTagFilter } from "@/lib/tag-filter-params";

export async function GET(request: NextRequest) {
  const denied = await requireSession(request);
  if (denied) return denied;

  const token = await dataplaneToken(request);
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

  const limit = searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined;
  const minCount = searchParams.get("min_count")
    ? Number(searchParams.get("min_count"))
    : undefined;

  const response = await sdk.getEntityGraph({
    client: lowLevelClientFor(token),
    path: { bank_id: bankId },
    query: { limit, min_count: minCount, ...readTagFilter(searchParams) },
  });
  return respondWithSdk(response, "Failed to fetch entity graph", { request });
}
