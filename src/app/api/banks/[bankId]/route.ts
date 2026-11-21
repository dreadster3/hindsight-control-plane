import { readJsonBody } from "@/lib/body-limit";
import { requireSession } from "@/lib/auth/require-session";
import { NextRequest, NextResponse } from "next/server";
import { localizeApiErrorPayload } from "@/lib/i18n/api-errors";
import { sdk, lowLevelClientFor } from "@/lib/hindsight-client";
import { dataplaneToken } from "@/lib/auth/dataplane-token";
import { respondWithSdk } from "@/lib/sdk-response";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ bankId: string }> }
) {
  const denied = await requireSession(request);
  if (denied) return denied;

  const token = await dataplaneToken(request);
  const { bankId } = await params;
  const parsedBody = await readJsonBody(request);
  if (!parsedBody.ok) return parsedBody.response;
  const body = parsedBody.body;

  if (!bankId) {
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
    path: { bank_id: bankId },
    body: {
      name: body.name,
      mission: body.mission,
      disposition: body.disposition,
    },
  });
  return respondWithSdk(response, "Failed to update bank", { request });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ bankId: string }> }
) {
  const denied = await requireSession(request);
  if (denied) return denied;

  const token = await dataplaneToken(request);
  const { bankId } = await params;
  const parsedBody = await readJsonBody(request);
  if (!parsedBody.ok) return parsedBody.response;
  const body = parsedBody.body;

  if (!bankId) {
    return NextResponse.json(
      localizeApiErrorPayload(request, {
        error: "bank_id is required",
        errorKey: "api.errors.validation.bankIdRequired",
      }),
      { status: 400 }
    );
  }

  const response = await sdk.updateBank({
    client: lowLevelClientFor(token),
    path: { bank_id: bankId },
    body: {
      name: body.name,
      mission: body.mission,
      disposition: body.disposition,
    },
  });
  return respondWithSdk(response, "Failed to update bank", { request });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ bankId: string }> }
) {
  const denied = await requireSession(request);
  if (denied) return denied;

  const token = await dataplaneToken(request);
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

  const response = await sdk.deleteBank({
    client: lowLevelClientFor(token),
    path: { bank_id: bankId },
  });
  return respondWithSdk(response, "Failed to delete bank", { request });
}
