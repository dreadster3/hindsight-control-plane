import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import {
  jsonBodyLimit,
  limitedBodyStream,
  oversizedBody,
  readFormDataLimited,
  readJsonBody,
  readJsonLimited,
} from "@/lib/body-limit";

const encoder = new TextEncoder();

function jsonRequest(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://localhost/api/banks", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

/** A stream body with no Content-Length — the chunked case the proxy is blind to. */
function chunkedRequest(chunks: string[], headers: Record<string, string> = {}) {
  let pulled = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled >= chunks.length) {
        controller.close();
        return;
      }
      const chunk = chunks[pulled];
      pulled += 1;
      controller.enqueue(encoder.encode(chunk));
    },
    cancel() {
      cancelled = true;
    },
  });
  const init = {
    method: "POST",
    headers,
    body: stream,
    // Node's fetch requires this for a streamed request body.
    duplex: "half",
  } as unknown as ConstructorParameters<typeof NextRequest>[1];
  const request = new NextRequest("http://localhost/api/banks", init);
  return { request, pulled: () => pulled, cancelled: () => cancelled };
}

afterEach(() => vi.unstubAllEnvs());

describe("oversizedBody", () => {
  it("refuses a declared body over the limit", async () => {
    vi.stubEnv("HINDSIGHT_CP_MAX_UPLOAD_SIZE", "1mb");
    const response = oversizedBody(jsonRequest({}, { "content-length": String(2 * 1024 * 1024) }));
    expect(response?.status).toBe(413);
    expect(await response?.json()).toMatchObject({
      error: expect.stringMatching(/too large/),
      sizeBytes: 2 * 1024 * 1024,
      limitBytes: 1024 * 1024,
    });
  });

  it("lets a body at the limit through", () => {
    vi.stubEnv("HINDSIGHT_CP_MAX_UPLOAD_SIZE", "1mb");
    expect(oversizedBody(jsonRequest({}, { "content-length": String(1024 * 1024) }))).toBeNull();
  });

  it("caps JSON routes at 10 MB even when uploads allow more", () => {
    vi.stubEnv("HINDSIGHT_CP_MAX_UPLOAD_SIZE", "1gb");
    expect(jsonBodyLimit()).toBe(10 * 1024 * 1024);
  });
});

describe("readJsonLimited", () => {
  it("parses a body under the limit", async () => {
    await expect(readJsonLimited(jsonRequest({ bank_id: "b" }))).resolves.toEqual({ bank_id: "b" });
  });

  it("aborts a chunked body past the limit and cancels the stream", async () => {
    const { request, pulled, cancelled } = chunkedRequest(["12345678", "12345678", "12345678"]);

    await expect(readJsonLimited(request, 10)).rejects.toBeInstanceOf(RangeError);
    // It stopped as soon as the second chunk crossed the limit — it did not
    // drain the rest of the body.
    expect(pulled()).toBe(2);
    expect(cancelled()).toBe(true);
  });
});

describe("readJsonBody", () => {
  it("returns the parsed body", async () => {
    const parsed = await readJsonBody<{ bank_id: string }>(jsonRequest({ bank_id: "b" }));
    expect(parsed.ok && parsed.body.bank_id).toBe("b");
  });

  it("maps an oversized body to a 413", async () => {
    const { request } = chunkedRequest(["12345678", "12345678"]);
    const parsed = await readJsonBody(request, 10);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.tooLarge).toBe(true);
    expect(parsed.response.status).toBe(413);
  });

  it("maps invalid JSON to the 400 the routes already used", async () => {
    const request = new NextRequest("http://localhost/api/banks", {
      method: "POST",
      body: "{not json",
    });
    const parsed = await readJsonBody(request);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.tooLarge).toBe(false);
    expect(parsed.response.status).toBe(400);
  });
});

describe("limitedBodyStream", () => {
  it("passes chunks through untouched under the limit", async () => {
    const { body, exceeded } = limitedBodyStream(
      new Blob(["hello"]).stream() as ReadableStream<Uint8Array>,
      10
    );
    expect(await new Response(body).text()).toBe("hello");
    expect(exceeded()).toBe(false);
  });

  it("errors the stream instead of buffering past the limit", async () => {
    const { body, exceeded } = limitedBodyStream(
      new Blob(["12345678", "12345678"]).stream() as ReadableStream<Uint8Array>,
      10
    );
    await expect(new Response(body).text()).rejects.toBeTruthy();
    expect(exceeded()).toBe(true);
  });
});

describe("readFormDataLimited (MAJOR-2)", () => {
  const boundary = "----hindsight-test";

  it("parses a multipart body under the limit", async () => {
    const body = `--${boundary}\r\nContent-Disposition: form-data; name="request"\r\n\r\n{"bank_id":"b"}\r\n--${boundary}--\r\n`;
    const { request } = chunkedRequest([body], {
      "content-type": `multipart/form-data; boundary=${boundary}`,
    });

    const upload = await readFormDataLimited(request, 4096);

    expect(upload.ok).toBe(true);
    if (!upload.ok) return;
    expect(upload.form.get("request")).toBe('{"bank_id":"b"}');
  });

  it("aborts a chunked multipart body past the limit instead of parsing it whole", async () => {
    const field = "x".repeat(400);
    const body = `--${boundary}\r\nContent-Disposition: form-data; name="request"\r\n\r\n${field}\r\n--${boundary}--\r\n`;
    const chunks = body.match(/[\s\S]{1,50}/g);
    if (!chunks) throw new Error("no chunks");
    const { request, pulled, cancelled } = chunkedRequest(chunks, {
      "content-type": `multipart/form-data; boundary=${boundary}`,
    });

    const upload = await readFormDataLimited(request, 80);

    expect(upload.ok).toBe(false);
    if (upload.ok) return;
    expect(upload.response.status).toBe(413);
    // No Content-Length was present, so this only passes because the stream was
    // counted: it stopped reading and cancelled the source, never parsing the
    // body as a whole.
    expect(cancelled()).toBe(true);
    expect(pulled()).toBeLessThan(chunks.length);
  });

  it("still refuses a declared oversize before reading anything", async () => {
    const request = new NextRequest("http://localhost/api/files/retain", {
      method: "POST",
      headers: { "content-length": String(2 * 1024 * 1024) },
    });
    vi.stubEnv("HINDSIGHT_CP_MAX_UPLOAD_SIZE", "1mb");

    const upload = await readFormDataLimited(request);

    expect(upload.ok).toBe(false);
    if (upload.ok) return;
    expect(upload.response.status).toBe(413);
  });
});
