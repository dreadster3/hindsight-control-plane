import { readJsonBody } from "@/lib/body-limit";
import { requireSession } from "@/lib/auth/require-session";
import { NextRequest, NextResponse } from "next/server";
import { localizeApiErrorPayload } from "@/lib/i18n/api-errors";
import { dataplaneBankUrl, getDataplaneHeaders } from "@/lib/hindsight-client";
import { dataplaneToken } from "@/lib/auth/dataplane-token";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ bankId: string; alias: string }> }
) {
  const denied = await requireSession(request);
  if (denied) return denied;

  const token = await dataplaneToken(request);
  try {
    const { bankId, alias } = await params;

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

    const response = await fetch(
      dataplaneBankUrl(bankId, `/aliases/${encodeURIComponent(alias)}`),
      {
        method: "PATCH",
        headers: getDataplaneHeaders(token, { "Content-Type": "application/json" }),
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("API error setting primary bank alias:", errorText);
      return NextResponse.json(
        localizeApiErrorPayload(request, {
          error: "Failed to update bank alias",
          errorKey: "api.errors.bankAliases.update",
        }),
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    console.error("Error setting primary bank alias:", error);
    return NextResponse.json(
      localizeApiErrorPayload(request, {
        error: "Failed to update bank alias",
        errorKey: "api.errors.bankAliases.update",
      }),
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ bankId: string; alias: string }> }
) {
  const denied = await requireSession(request);
  if (denied) return denied;

  const token = await dataplaneToken(request);
  try {
    const { bankId, alias } = await params;

    if (!bankId) {
      return NextResponse.json(
        localizeApiErrorPayload(request, {
          error: "bank_id is required",
          errorKey: "api.errors.validation.bankIdRequired",
        }),
        { status: 400 }
      );
    }

    const response = await fetch(
      dataplaneBankUrl(bankId, `/aliases/${encodeURIComponent(alias)}`),
      { method: "DELETE", headers: getDataplaneHeaders(token) }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("API error deleting bank alias:", errorText);
      return NextResponse.json(
        localizeApiErrorPayload(request, {
          error: "Failed to delete bank alias",
          errorKey: "api.errors.bankAliases.delete",
        }),
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    console.error("Error deleting bank alias:", error);
    return NextResponse.json(
      localizeApiErrorPayload(request, {
        error: "Failed to delete bank alias",
        errorKey: "api.errors.bankAliases.delete",
      }),
      { status: 500 }
    );
  }
}
