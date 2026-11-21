import { requireSession } from "@/lib/auth/require-session";
import { NextRequest, NextResponse } from "next/server";
import { localizeApiErrorPayload } from "@/lib/i18n/api-errors";
import { dataplaneBankUrl, getDataplaneHeaders } from "@/lib/hindsight-client";
import { dataplaneToken } from "@/lib/auth/dataplane-token";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ bankId: string }> }
) {
  const denied = await requireSession(request);
  if (denied) return denied;

  const token = await dataplaneToken(request);
  try {
    const { bankId } = await params;

    const url = dataplaneBankUrl(bankId, "/export");
    const response = await fetch(url, {
      headers: getDataplaneHeaders(token),
    });

    const data = await response.json();
    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    console.error("Error exporting bank template:", error);
    return NextResponse.json(
      localizeApiErrorPayload(request, {
        error: "Failed to export bank template",
        errorKey: "api.errors.banks.exportTemplate",
      }),
      { status: 500 }
    );
  }
}
