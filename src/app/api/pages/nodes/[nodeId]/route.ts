import { readJsonBody } from "@/lib/body-limit";
import { requireSession } from "@/lib/auth/require-session";
import { NextRequest, NextResponse } from "next/server";
import { localizeApiErrorPayload } from "@/lib/i18n/api-errors";
import { dataplaneBankUrl, getDataplaneHeaders } from "@/lib/hindsight-client";
import { dataplaneToken } from "@/lib/auth/dataplane-token";

function bankId(request: NextRequest): string | null {
  return request.nextUrl.searchParams.get("bank_id");
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ nodeId: string }> }
) {
  const denied = await requireSession(request);
  if (denied) return denied;

  const token = await dataplaneToken(request);
  try {
    const { nodeId } = await params;
    const bank = bankId(request);
    if (!bank) {
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
      dataplaneBankUrl(bank, `/pages/nodes/${encodeURIComponent(decodeURIComponent(nodeId))}`),
      {
        method: "PATCH",
        headers: getDataplaneHeaders(token, { "Content-Type": "application/json" }),
        body: JSON.stringify(body),
      }
    );
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }));
      return NextResponse.json(error, { status: response.status });
    }
    return NextResponse.json(await response.json(), { status: 200 });
  } catch (error) {
    console.error("Failed to update node:", error);
    return NextResponse.json(
      localizeApiErrorPayload(request, {
        error: "Failed to update node",
        errorKey: "api.errors.pages.updateNode",
      }),
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ nodeId: string }> }
) {
  const denied = await requireSession(request);
  if (denied) return denied;

  const token = await dataplaneToken(request);
  try {
    const { nodeId } = await params;
    const bank = bankId(request);
    if (!bank) {
      return NextResponse.json(
        localizeApiErrorPayload(request, {
          error: "bank_id is required",
          errorKey: "api.errors.validation.bankIdRequired",
        }),
        { status: 400 }
      );
    }
    const response = await fetch(
      dataplaneBankUrl(bank, `/pages/nodes/${encodeURIComponent(decodeURIComponent(nodeId))}`),
      { method: "DELETE", headers: getDataplaneHeaders(token) }
    );
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }));
      return NextResponse.json(error, { status: response.status });
    }
    return NextResponse.json(await response.json(), { status: 200 });
  } catch (error) {
    console.error("Failed to delete node:", error);
    return NextResponse.json(
      localizeApiErrorPayload(request, {
        error: "Failed to delete node",
        errorKey: "api.errors.pages.deleteNode",
      }),
      { status: 500 }
    );
  }
}
