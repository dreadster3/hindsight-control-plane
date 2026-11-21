import { readJsonBody } from "@/lib/body-limit";
import { requireSession } from "@/lib/auth/require-session";
import { NextRequest, NextResponse } from "next/server";
import { localizeApiErrorPayload } from "@/lib/i18n/api-errors";
import { lowLevelClientFor, sdk } from "@/lib/hindsight-client";
import { dataplaneToken } from "@/lib/auth/dataplane-token";

export async function POST(request: NextRequest) {
  const denied = await requireSession(request);
  if (denied) return denied;

  const token = await dataplaneToken(request);
  try {
    const parsedBody = await readJsonBody(request);
    if (!parsedBody.ok) return parsedBody.response;
    const body = parsedBody.body;
    const bankId = body.bank_id || body.agent_id || "default";
    const {
      query,
      types,
      fact_type,
      prefer_observations,
      rerank,
      max_tokens,
      trace,
      budget,
      include,
      query_timestamp,
      tags,
      tags_match,
      tag_groups,
      min_scores,
      temporal_window,
    } = body;

    const response = await sdk.recallMemories({
      client: lowLevelClientFor(token),
      path: { bank_id: bankId },
      body: {
        query,
        types: types || fact_type,
        prefer_observations,
        rerank,
        max_tokens,
        trace,
        budget: budget || "mid",
        include,
        query_timestamp,
        tags,
        tags_match,
        tag_groups,
        min_scores,
        temporal_window,
      },
    });

    if (!response.data) {
      console.error("[Recall API] No data in response", { response, error: response.error });
      throw new Error(`API returned no data: ${JSON.stringify(response.error || "Unknown error")}`);
    }

    // Pass the whole body through: a hand-picked projection silently dropped
    // fields the caller asked for (source_facts, source_facts_truncated).
    return NextResponse.json(response.data, { status: 200 });
  } catch (error) {
    console.error("Error recalling:", error);
    return NextResponse.json(
      localizeApiErrorPayload(request, {
        error: "Failed to recall",
        errorKey: "api.errors.recall.failed",
      }),
      { status: 500 }
    );
  }
}
