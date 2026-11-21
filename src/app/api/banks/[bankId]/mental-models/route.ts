import { readJsonBody } from "@/lib/body-limit";
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
    const { searchParams } = new URL(request.url);
    const tags = searchParams.getAll("tags");
    const tagsMatch = searchParams.get("tags_match");
    const detail = searchParams.get("detail");
    const limit = searchParams.get("limit");
    const offset = searchParams.get("offset");
    const excludePages = searchParams.get("exclude_pages");

    if (!bankId) {
      return NextResponse.json(
        localizeApiErrorPayload(request, {
          error: "bank_id is required",
          errorKey: "api.errors.validation.bankIdRequired",
        }),
        { status: 400 }
      );
    }

    const queryParams = new URLSearchParams();
    if (tags.length > 0) {
      tags.forEach((t) => queryParams.append("tags", t));
    }
    if (tagsMatch) {
      queryParams.append("tags_match", tagsMatch);
    }
    if (detail) {
      queryParams.append("detail", detail);
    }
    if (limit) {
      queryParams.append("limit", limit);
    }
    if (offset) {
      queryParams.append("offset", offset);
    }
    if (excludePages) {
      queryParams.append("exclude_pages", excludePages);
    }

    const url = dataplaneBankUrl(
      bankId,
      `/mental-models${queryParams.toString() ? `?${queryParams}` : ""}`
    );
    const response = await fetch(url, { method: "GET", headers: getDataplaneHeaders(token) });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("API error listing mental models:", errorText);
      return NextResponse.json(
        localizeApiErrorPayload(request, {
          error: "Failed to list mental models",
          errorKey: "api.errors.mentalModels.list",
        }),
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    console.error("Error listing mental models:", error);
    return NextResponse.json(
      localizeApiErrorPayload(request, {
        error: "Failed to list mental models",
        errorKey: "api.errors.mentalModels.list",
      }),
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ bankId: string }> }
) {
  const denied = await requireSession(request);
  if (denied) return denied;

  const token = await dataplaneToken(request);
  try {
    const { bankId } = await params;

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

    const response = await fetch(dataplaneBankUrl(bankId, "/mental-models"), {
      method: "POST",
      headers: getDataplaneHeaders(token, { "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("API error creating mental model:", errorText);
      return NextResponse.json(
        localizeApiErrorPayload(request, {
          error: errorText || "Failed to create mental model",
          errorKey: "api.errors.mentalModels.create",
        }),
        { status: response.status }
      );
    }

    const data = await response.json();
    // Returns operation_id - content is generated in background
    return NextResponse.json(data, { status: 202 });
  } catch (error) {
    console.error("Error creating mental model:", error);
    return NextResponse.json(
      localizeApiErrorPayload(request, {
        error: "Failed to create mental model",
        errorKey: "api.errors.mentalModels.create",
      }),
      { status: 500 }
    );
  }
}
