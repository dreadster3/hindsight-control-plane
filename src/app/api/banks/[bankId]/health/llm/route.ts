import { requireSession } from "@/lib/auth/require-session";
import { NextRequest } from "next/server";
import { lowLevelClientFor, sdk } from "@/lib/hindsight-client";
import { dataplaneToken } from "@/lib/auth/dataplane-token";
import { respondWithSdk } from "@/lib/sdk-response";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ bankId: string }> }
) {
  const denied = await requireSession(request);
  if (denied) return denied;

  const token = await dataplaneToken(request);
  const { bankId } = await params;
  const response = await sdk.testBankLlm({
    client: lowLevelClientFor(token),
    path: { bank_id: bankId },
  });
  return respondWithSdk(response, "Failed to test bank LLM connectivity", { request });
}
