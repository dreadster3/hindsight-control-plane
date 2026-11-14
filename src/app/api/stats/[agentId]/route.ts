import { NextRequest } from "next/server";
import { sdk, lowLevelClientFor } from "@/lib/hindsight-client";
import { dataplaneToken } from "@/lib/auth/dataplane-token";
import { respondWithSdk } from "@/lib/sdk-response";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const token = await dataplaneToken(request);
  const { agentId } = await params;
  const response = await sdk.getAgentStats({
    client: lowLevelClientFor(token),
    path: { bank_id: agentId },
  });
  return respondWithSdk(response, "Failed to fetch stats", { request });
}
