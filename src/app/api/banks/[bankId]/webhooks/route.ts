import { readJsonBody } from "@/lib/body-limit";
import { requireSession } from "@/lib/auth/require-session";
import { NextRequest, NextResponse } from "next/server";
import { dataplaneBankUrl, getDataplaneHeaders } from "@/lib/hindsight-client";
import { dataplaneToken } from "@/lib/auth/dataplane-token";
import { localizeApiErrorPayload } from "@/lib/i18n/api-errors";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ bankId: string }> }
) {
  const denied = await requireSession(request);
  if (denied) return denied;

  const token = await dataplaneToken(request);
  const { bankId } = await params;
  const { searchParams } = new URL(request.url);
  const queryParams = new URLSearchParams();
  for (const key of ["limit", "offset"]) {
    const value = searchParams.get(key);
    if (value) queryParams.append(key, value);
  }
  const path = `/webhooks${queryParams.toString() ? `?${queryParams}` : ""}`;
  const res = await fetch(dataplaneBankUrl(bankId, path), {
    headers: getDataplaneHeaders(token, { "Content-Type": "application/json" }),
  });
  const data = await res.json();
  if (!res.ok)
    return NextResponse.json(
      localizeApiErrorPayload(request, {
        error: data.detail || "Failed to list webhooks",
        errorKey: "api.errors.webhooks.list",
      }),
      { status: res.status }
    );
  return NextResponse.json(data);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ bankId: string }> }
) {
  const denied = await requireSession(request);
  if (denied) return denied;

  const token = await dataplaneToken(request);
  const { bankId } = await params;
  const parsedBody = await readJsonBody(request);
  if (!parsedBody.ok) return parsedBody.response;
  const body = parsedBody.body;
  const res = await fetch(dataplaneBankUrl(bankId, "/webhooks"), {
    method: "POST",
    headers: getDataplaneHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok)
    return NextResponse.json(
      localizeApiErrorPayload(request, {
        error: data.detail || "Failed to create webhook",
        errorKey: "api.errors.webhooks.create",
      }),
      { status: res.status }
    );
  return NextResponse.json(data, { status: 201 });
}
