import { NextRequest, NextResponse } from "next/server";
import { localizeApiErrorPayload } from "@/lib/i18n/api-errors";
import { sdk, lowLevelClientFor } from "@/lib/hindsight-client";
import { dataplaneToken } from "@/lib/auth/dataplane-token";
import { respondWithSdk } from "@/lib/sdk-response";

const HTTP_CREATED = 201;

export async function GET(request: NextRequest) {
  const token = await dataplaneToken(request);
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q");
  const limit = searchParams.get("limit");
  const offset = searchParams.get("offset");
  const response = await sdk.listBanks({
    client: lowLevelClientFor(token),
    query: {
      ...(q ? { q } : {}),
      ...(limit !== null ? { limit: Number(limit) } : {}),
      ...(offset !== null ? { offset: Number(offset) } : {}),
    },
  });
  return respondWithSdk(response, "Failed to fetch banks", { request });
}

export async function POST(request: NextRequest) {
  const token = await dataplaneToken(request);
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      localizeApiErrorPayload(request, {
        error: "Invalid JSON body",
        errorKey: "api.errors.auth.invalidRequestBody",
      }),
      { status: 400 }
    );
  }
  const { bank_id } = body;

  if (!bank_id) {
    return NextResponse.json(
      localizeApiErrorPayload(request, {
        error: "bank_id is required",
        errorKey: "api.errors.validation.bankIdRequired",
      }),
      { status: 400 }
    );
  }

  const response = await sdk.createOrUpdateBank({
    client: lowLevelClientFor(token),
    path: { bank_id },
    body: {},
  });
  return respondWithSdk(response, "Failed to create bank", HTTP_CREATED, { request });
}
