import { readJsonBody } from "@/lib/body-limit";
import { requireSession } from "@/lib/auth/require-session";
import { NextRequest, NextResponse } from "next/server";
import { localizeApiErrorPayload } from "@/lib/i18n/api-errors";
import { dataplaneBankUrl, getDataplaneHeaders } from "@/lib/hindsight-client";
import { dataplaneToken } from "@/lib/auth/dataplane-token";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ bankId: string }> }
) {
  const denied = await requireSession(request);
  if (denied) return denied;

  const token = await dataplaneToken(request);
  try {
    const { bankId } = await params;
    const parsedBody = await readJsonBody(request);
    if (!parsedBody.ok) return parsedBody.response;
    const body = parsedBody.body;
    const dryRun = request.nextUrl.searchParams.get("dry_run") === "true";

    // Direct fetch since the SDK doesn't have this operation yet
    const url = dataplaneBankUrl(bankId, `/import${dryRun ? "?dry_run=true" : ""}`);
    const response = await fetch(url, {
      method: "POST",
      headers: getDataplaneHeaders(token, { "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });

    const data = await response.json();
    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    console.error("Error importing bank template:", error);
    return NextResponse.json(
      localizeApiErrorPayload(request, {
        error: "Failed to import bank template",
        errorKey: "api.errors.banks.importTemplate",
      }),
      { status: 500 }
    );
  }
}
