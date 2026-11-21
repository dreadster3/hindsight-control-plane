import { readJsonBody } from "@/lib/body-limit";
import { requireSession } from "@/lib/auth/require-session";
import { NextRequest } from "next/server";
import { lowLevelClientFor, sdk } from "@/lib/hindsight-client";
import { dataplaneToken } from "@/lib/auth/dataplane-token";
import { respondWithSdk } from "@/lib/sdk-response";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ bankId: string }> }
) {
  const denied = await requireSession(request);
  if (denied) return denied;

  const token = await dataplaneToken(request);
  const { bankId } = await params;
  const response = await sdk.getBankConfig({
    client: lowLevelClientFor(token),
    path: { bank_id: bankId },
  });
  return respondWithSdk(response, "Failed to fetch bank config", { request });
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
  const { updates } = body;

  const response = await sdk.updateBankConfig({
    client: lowLevelClientFor(token),
    path: { bank_id: bankId },
    body: { updates },
  });
  return respondWithSdk(response, "Failed to update bank config", { request });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ bankId: string }> }
) {
  const denied = await requireSession(request);
  if (denied) return denied;

  const token = await dataplaneToken(request);
  const { bankId } = await params;
  const response = await sdk.resetBankConfig({
    client: lowLevelClientFor(token),
    path: { bank_id: bankId },
  });
  return respondWithSdk(response, "Failed to reset bank config", { request });
}
