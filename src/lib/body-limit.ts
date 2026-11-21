import { NextRequest, NextResponse } from "next/server";

import { localizeApiErrorPayload } from "@/lib/i18n/api-errors";
import { maxUploadBytes } from "@/lib/upload-limit";

/**
 * Handler-level body caps. The proxy's Content-Length check is an optimization:
 * a matcher regression skips it, and it is blind to a chunked body (no
 * Content-Length), which is how a 20 MB "JSON" PATCH used to reach a 256 Mi pod
 * and get buffered + parsed. Every handler that reads a body bounds it here.
 *
 * JSON routes get a small cap of their own — no legitimate JSON document is
 * 10 MB — while file uploads keep the HINDSIGHT_CP_MAX_UPLOAD_SIZE ceiling.
 */
const JSON_BODY_LIMIT_BYTES = 10 * 1024 * 1024;

export function jsonBodyLimit(): number {
  return Math.min(JSON_BODY_LIMIT_BYTES, maxUploadBytes());
}

/** The 413 payload for a body over the limit; sizeBytes when it was declared. */
export function bodyTooLarge(limitBytes: number, sizeBytes?: number): NextResponse {
  return NextResponse.json(
    {
      error: "Request too large",
      errorKey: "api.errors.request.tooLarge",
      ...(sizeBytes !== undefined ? { sizeBytes } : {}),
      limitBytes,
    },
    { status: 413 }
  );
}

/** 413 when the declared Content-Length is over the limit; null otherwise. */
export function oversizedBody(
  request: NextRequest,
  limit = jsonBodyLimit()
): NextResponse | null {
  const size = Number(request.headers.get("content-length") ?? 0);
  return size > limit ? bodyTooLarge(limit, size) : null;
}

/** Counts the bytes actually received; chunked bodies carry no usable length. */
async function readBytesLimited(request: NextRequest, limit: number): Promise<Uint8Array> {
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError("Empty body");
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new RangeError("Request too large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** Bounded JSON read: throws RangeError past the limit, SyntaxError on bad JSON. */
export async function readJsonLimited<T = any>(
  request: NextRequest,
  limit = jsonBodyLimit()
): Promise<T> {
  return JSON.parse(new TextDecoder().decode(await readBytesLimited(request, limit)));
}

/** Bounded text read, for handlers that forward a raw JSON body verbatim. */
export async function readTextLimited(
  request: NextRequest,
  limit = jsonBodyLimit()
): Promise<string> {
  return new TextDecoder().decode(await readBytesLimited(request, limit));
}

export type JsonBodyResult<T> =
  | { ok: true; body: T }
  | { ok: false; response: NextResponse; tooLarge: boolean };

/**
 * Route-level helper: the parsed body, or the 413/400 response to return
 * instead. `tooLarge` lets the two handlers that accept an absent body tell a
 * refused oversized upload (413) apart from an empty one.
 */
export async function readJsonBody<T = any>(
  request: NextRequest,
  limit = jsonBodyLimit()
): Promise<JsonBodyResult<T>> {
  const tooLarge = oversizedBody(request, limit);
  if (tooLarge) return { ok: false, response: tooLarge, tooLarge: true };
  try {
    return { ok: true, body: await readJsonLimited<T>(request, limit) };
  } catch (error) {
    if (error instanceof RangeError) {
      return { ok: false, response: bodyTooLarge(limit), tooLarge: true };
    }
    return {
      ok: false,
      tooLarge: false,
      response: NextResponse.json(
        localizeApiErrorPayload(request, {
          error: "Invalid JSON body",
          errorKey: "api.errors.auth.invalidRequestBody",
        }),
        { status: 400 }
      ),
    };
  }
}

/**
 * A counting stream for bodies forwarded as-is (the knowledge-banks catch-all
 * streams uploads straight to the dataplane and must never buffer them). Errors
 * the stream past the limit, which aborts the upstream request.
 */
export function limitedBodyStream(
  body: ReadableStream<Uint8Array> | null,
  limit = maxUploadBytes()
): { body: ReadableStream<Uint8Array> | null; exceeded: () => boolean } {
  if (!body) return { body: null, exceeded: () => false };
  // Pumped by hand rather than pipeThrough: on a refused chunk this must cancel
  // the source reader, or the sender keeps streaming into a body nobody reads.
  const reader = body.getReader();
  let total = 0;
  let exceeded = false;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      total += value.byteLength;
      if (total > limit) {
        exceeded = true;
        await reader.cancel().catch(() => undefined);
        controller.error(new RangeError("Request too large"));
        return;
      }
      controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  return { body: stream, exceeded: () => exceeded };
}

export type FormDataResult =
  | { ok: true; form: FormData }
  | { ok: false; response: NextResponse };

/**
 * Multipart upload without the buffering bypass: the body is counted as
 * formData() consumes it, so a chunked upload (no Content-Length to check)
 * is still cut off at the ceiling instead of being parsed whole.
 */
export async function readFormDataLimited(
  request: NextRequest,
  limit = maxUploadBytes()
): Promise<FormDataResult> {
  const tooLarge = oversizedBody(request, limit);
  if (tooLarge) return { ok: false, response: tooLarge };

  const counted = limitedBodyStream(request.body, limit);
  const headers = new Headers(request.headers);
  // The streamed copy has no declared length; a stale one would only lie to undici.
  headers.delete("content-length");
  try {
    const streamed = new Request(request.url, {
      method: request.method,
      headers,
      body: counted.body,
      // Required by Node's fetch to read a streamed request body.
      duplex: "half",
    } as RequestInit);
    return { ok: true, form: await streamed.formData() };
  } catch (error) {
    if (counted.exceeded()) return { ok: false, response: bodyTooLarge(limit) };
    throw error;
  }
}
