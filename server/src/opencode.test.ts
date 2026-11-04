import { afterEach, describe, expect, it, vi } from "vitest";

import { config } from "./config";
import { generateCompletion, maxTokensLimit } from "./opencode";

const mutable = config as unknown as { idleTimeoutMs: number };
const realIdle = config.idleTimeoutMs;

afterEach(() => {
  vi.restoreAllMocks();
  mutable.idleTimeoutMs = realIdle;
});

const sse = (events: string[], stallAfter = false): Response => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const e of events) controller.enqueue(encoder.encode(`data: ${e}\n\n`));
      if (stallAfter) return; // a stalled stream simply never closes
      // a finished reply ends with a finish reason (a stream without one was cut off)
      if (!events.some((e) => e.includes("finish_reason"))) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
};

const chunk = (content: string) => JSON.stringify({ choices: [{ delta: { content } }] });

describe("generateCompletion", () => {
  it("aborts a stream that goes quiet instead of waiting for the hard cap", async () => {
    mutable.idleTimeoutMs = 60;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => sse([chunk("partial")], true));
    const started = Date.now();
    await expect(generateCompletion([{ role: "user", content: "hi" }], { model: "glm-5.3" })).rejects.toThrow(/stalled/);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("gives up on a frozen stream on time even when the stream ignores cancel", async () => {
    mutable.idleTimeoutMs = 60;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${chunk("partial")}\n\n`));
        },
        // a frozen upstream: cancel never settles, so a pending read is never woken by it
        cancel: () => new Promise<void>(() => undefined),
      });
      return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
    });
    const started = Date.now();
    await expect(generateCompletion([{ role: "user", content: "hi" }], { model: "frozen-model" })).rejects.toThrow(/stalled/);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("retries every parallel call a model rejected for its temperature", async () => {
    const seen: Array<boolean> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const sent = "temperature" in JSON.parse(String(init?.body));
      seen.push(sent);
      if (sent) {
        await new Promise((r) => setTimeout(r, 20)); // both requests are in flight together
        return new Response('{"error":{"message":"invalid temperature: only 1 is allowed"}}', { status: 400 });
      }
      return sse([chunk("ok")]);
    });
    const model = "temp-strict-model";
    const [a, b] = await Promise.all([
      generateCompletion([{ role: "user", content: "a" }], { model }),
      generateCompletion([{ role: "user", content: "b" }], { model }),
    ]);
    expect([a.text, b.text]).toEqual(["ok", "ok"]);
    expect(seen.filter(Boolean)).toHaveLength(2);
  });

  it("retries a rate-limited call and then succeeds", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("slow down", { status: 429, headers: { "retry-after": "0.01" } }))
      .mockResolvedValueOnce(sse([chunk("Hello"), chunk(" there"), JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })]));
    const result = await generateCompletion([{ role: "user", content: "hi" }], { model: "glm-5.3" });
    expect(result.text).toBe("Hello there");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("learns a model's output token limit from its 400 and retries under it", async () => {
    const sent: number[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const max = JSON.parse(String(init?.body)).max_tokens as number;
      sent.push(max);
      if (max > 131072) {
        return new Response('{"error":{"type":"invalid_request_error","message":"Upstream request failed: [invalid_parameter_error] <400> InternalError.Algo.InvalidParameter: Range of max_tokens should be [1, 131072]"}}', { status: 400 });
      }
      return sse([chunk("ok")]);
    });
    const model = "capped-model";
    expect((await generateCompletion([{ role: "user", content: "a" }], { model, maxTokens: 240000 })).text).toBe("ok");
    expect((await generateCompletion([{ role: "user", content: "b" }], { model, maxTokens: 240000 })).text).toBe("ok");
    // one rejected call, then every call goes out under the cap
    expect(sent).toEqual([240000, 131072, 131072]);
  });
});

describe("thinking off", () => {
  it("steps down to the least thinking a model accepts when it refuses \"none\" (GLM: \"always reasons\")", async () => {
    const sent: Array<string | undefined> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const effort = JSON.parse(String(init?.body)).reasoning_effort as string | undefined;
      sent.push(effort);
      if (effort === "none") {
        return new Response('{"error":{"param":"reasoning_effort","type":"invalid_request_error","message":"Upstream request failed: [invalid_value] This model always reasons and does not support disabling reasoning; do not send a reasoning-off selector."}}', { status: 400 });
      }
      return sse([chunk("ok")]);
    });
    const model = "always-reasons-model";
    expect((await generateCompletion([{ role: "user", content: "a" }], { model })).text).toBe("ok");
    expect((await generateCompletion([{ role: "user", content: "b" }], { model })).text).toBe("ok");
    // one refused call, then "minimal" every time: not left out (that let it think at length)
    expect(sent).toEqual(["none", "minimal", "minimal"]);
  });
});

describe("cut-off replies", () => {
  it("rejects a stream that ends without a finish reason", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(encoder.encode(`data: ${chunk('export const Scene = () => <div>{"7')}\n\n`));
          c.close();
        },
      });
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    });
    await expect(generateCompletion([{ role: "user", content: "hi" }], { model: "cut-model" })).rejects.toThrow(/cut off/);
  });
});

describe("maxTokensLimit", () => {
  it("reads the bound from the gateway's range errors and ignores other errors", () => {
    expect(maxTokensLimit("Range of max_tokens should be [1, 131072]")).toBe(131072);
    expect(maxTokensLimit(`{"type":"error","error":{"type":"invalid_request_error","message":"max_tokens: 240000 > 128000, which is the maximum allowed number of output tokens for claude-haiku-5-5"}}`)).toBe(128000);
    expect(maxTokensLimit("max_tokens: 240000 > 65536, which is the maximum allowed... must be less than or equal to 65536")).toBe(65536);
    expect(maxTokensLimit("invalid temperature: only 1 is allowed")).toBeNull();
  });
});
