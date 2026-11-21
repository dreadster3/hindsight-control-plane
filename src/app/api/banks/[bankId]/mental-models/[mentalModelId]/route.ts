import { readJsonBody } from "@/lib/body-limit";
import { requireSession } from "@/lib/auth/require-session";
import { NextRequest, NextResponse } from "next/server";
import { localizeApiErrorPayload } from "@/lib/i18n/api-errors";
import { dataplaneBankUrl, getDataplaneHeaders } from "@/lib/hindsight-client";
import { dataplaneToken } from "@/lib/auth/dataplane-token";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ bankId: string; mentalModelId: string }> }
) {
  const denied = await requireSession(request);
  if (denied) return denied;

  const token = await dataplaneToken(request);
  try {
    const { bankId, mentalModelId } = await params;

    if (!bankId || !mentalModelId) {
      return NextResponse.json(
        localizeApiErrorPayload(request, {
          error: "bank_id and mental_model_id are required",
          errorKey: "api.errors.validation.bankAndMentalModelIdRequired",
        }),
        { status: 400 }
      );
    }

    const response = await fetch(
      dataplaneBankUrl(bankId, `/mental-models/${encodeURIComponent(mentalModelId)}`),
      { method: "GET", headers: getDataplaneHeaders(token) }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("API error getting mental model:", errorText);
      return NextResponse.json(
        localizeApiErrorPayload(request, {
          error: "Failed to get mental model",
          errorKey: "api.errors.mentalModels.fetch",
        }),
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    console.error("Error getting mental model:", error);
    return NextResponse.json(
      localizeApiErrorPayload(request, {
        error: "Failed to get mental model",
        errorKey: "api.errors.mentalModels.fetch",
      }),
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ bankId: string; mentalModelId: string }> }
) {
  const denied = await requireSession(request);
  if (denied) return denied;

  const token = await dataplaneToken(request);
  try {
    const { bankId, mentalModelId } = await params;

    if (!bankId || !mentalModelId) {
      return NextResponse.json(
        localizeApiErrorPayload(request, {
          error: "bank_id and mental_model_id are required",
          errorKey: "api.errors.validation.bankAndMentalModelIdRequired",
        }),
        { status: 400 }
      );
    }

    const parsedBody = await readJsonBody(request);

    if (!parsedBody.ok) return parsedBody.response;

    const body = parsedBody.body;

    const response = await fetch(
      dataplaneBankUrl(bankId, `/mental-models/${encodeURIComponent(mentalModelId)}`),
      {
        method: "PATCH",
        headers: getDataplaneHeaders(token, { "Content-Type": "application/json" }),
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("API error updating mental model:", errorText);
      return NextResponse.json(
        localizeApiErrorPayload(request, {
          error: errorText || "Failed to update mental model",
          errorKey: "api.errors.mentalModels.update",
        }),
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    console.error("Error updating mental model:", error);
    return NextResponse.json(
      localizeApiErrorPayload(request, {
        error: "Failed to update mental model",
        errorKey: "api.errors.mentalModels.update",
      }),
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ bankId: string; mentalModelId: string }> }
) {
  const denied = await requireSession(request);
  if (denied) return denied;

  const token = await dataplaneToken(request);
  try {
    const { bankId, mentalModelId } = await params;

    if (!bankId || !mentalModelId) {
      return NextResponse.json(
        localizeApiErrorPayload(request, {
          error: "bank_id and mental_model_id are required",
          errorKey: "api.errors.validation.bankAndMentalModelIdRequired",
        }),
        { status: 400 }
      );
    }

    const response = await fetch(
      dataplaneBankUrl(bankId, `/mental-models/${encodeURIComponent(mentalModelId)}`),
      { method: "DELETE", headers: getDataplaneHeaders(token) }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("API error deleting mental model:", errorText);
      return NextResponse.json(
        localizeApiErrorPayload(request, {
          error: errorText || "Failed to delete mental model",
          errorKey: "api.errors.mentalModels.delete",
        }),
        { status: response.status }
      );
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Error deleting mental model:", error);
    return NextResponse.json(
      localizeApiErrorPayload(request, {
        error: "Failed to delete mental model",
        errorKey: "api.errors.mentalModels.delete",
      }),
      { status: 500 }
    );
  }
}
