import { requireSession } from "@/lib/auth/require-session";
import { NextRequest } from "next/server";
import { sdk, lowLevelClientFor } from "@/lib/hindsight-client";
import { dataplaneToken } from "@/lib/auth/dataplane-token";
import { respondWithSdk } from "@/lib/sdk-response";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ bankId: string; logId: string }> }
) {
  const denied = await requireSession(request);
  if (denied) return denied;

  const token = await dataplaneToken(request);
  const { bankId, logId } = await params;
  const response = await sdk.getAuditLog({
    client: lowLevelClientFor(token),
    path: { bank_id: bankId, log_id: logId },
  });
  return respondWithSdk(response, "Failed to get audit log entry", {
    request,
    errorKey: "api.errors.auditLogs.get",
  });
}
