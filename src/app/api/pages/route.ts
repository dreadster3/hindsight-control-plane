import { readJsonBody } from "@/lib/body-limit";
import { requireSession } from "@/lib/auth/require-session";
import { NextRequest, NextResponse } from "next/server";
import { localizeApiErrorPayload } from "@/lib/i18n/api-errors";
import { dataplaneBankUrl, getDataplaneHeaders } from "@/lib/hindsight-client";
import { dataplaneToken } from "@/lib/auth/dataplane-token";

export async function POST(request: NextRequest) {
  const denied = await requireSession(request);
  if (denied) return denied;

  const token = await dataplaneToken(request);
  try {
    const bankId = request.nextUrl.searchParams.get("bank_id");
    if (!bankId) {
      return NextResponse.json(
        localizeApiErrorPayload(request, {
          error: "bank_id is required",
          errorKey: "api.errors.validation.bankIdRequired",
        }),
        { status: 400 }
      );
    }
    const parsedBody = await readJsonBody(request);
    if (!parsedBody.ok) return parsedBody.response;
    const body = parsedBody.body;
    const response = await fetch(dataplaneBankUrl(bankId, "/pages"), {
      method: "POST",
      headers: getDataplaneHeaders(token, { "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }));
      return NextResponse.json(error, { status: response.status });
    }
    return NextResponse.json(await response.json(), { status: response.status });
  } catch (error) {
    console.error("Failed to create page:", error);
    return NextResponse.json(
      localizeApiErrorPayload(request, {
        error: "Failed to create page",
        errorKey: "api.errors.pages.createPage",
      }),
      { status: 500 }
    );
  }
}
