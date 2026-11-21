import { requireSession } from "@/lib/auth/require-session";
import { NextRequest } from "next/server";
import { missingQueryParam } from "@/lib/i18n/api-errors";
import { sdk, lowLevelClientFor } from "@/lib/hindsight-client";
import { dataplaneToken } from "@/lib/auth/dataplane-token";
import { respondWithSdk } from "@/lib/sdk-response";

export async function GET(request: NextRequest) {
  const denied = await requireSession(request);
  if (denied) return denied;

  const token = await dataplaneToken(request);
  const chunkId = request.nextUrl.searchParams.get("chunk_id");
  if (!chunkId) return missingQueryParam(request, "chunk_id");

  const response = await sdk.getChunk({
    client: lowLevelClientFor(token),
    path: { chunk_id: chunkId },
  });
  return respondWithSdk(response, "Failed to fetch chunk", { request });
}
