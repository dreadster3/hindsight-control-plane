import { readJsonBody } from "@/lib/body-limit";
import { requireSession } from "@/lib/auth/require-session";
import { NextRequest } from "next/server";
import { lowLevelClientFor, sdk } from "@/lib/hindsight-client";
import { dataplaneToken } from "@/lib/auth/dataplane-token";
import { respondWithSdk } from "@/lib/sdk-response";

/**
 * Proxy for the dataplane dry-run extraction endpoint: extract facts from sample
 * text without storing anything. Bank-scoped, so the prompt tester can reach it the
 * same way it reaches the prompt preview.
 */
export async function POST(
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
  const response = await sdk.dryRunExtractMemories({
    client: lowLevelClientFor(token),
    path: { bank_id: bankId },
    body,
  });
  return respondWithSdk(response, "Failed to run dry-run extraction", { request });
}
