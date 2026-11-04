import { afterEach, describe, expect, it, vi } from "vitest";

import { withCallContext } from "../lib/calls";
import { generateCompletion } from "../opencode";
import { flushUsage, onUsage, setUsageSink, type UsageEvent } from "./ledger";
import { setPrices } from "./prices";
import { foldUsage, emptyUsage, IMAGE_TOKENS } from "./tokens";

const sse = (events: unknown[]): Response => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const e of events) controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
};

const capture = () => {
  const events: UsageEvent[] = [];
  const off = onUsage((e) => events.push(e));
  return { events, off };
};

afterEach(() => {
  vi.restoreAllMocks();
  setPrices({});
});

// keep test runs out of data/usage.jsonl
setUsageSink(async () => undefined);

describe("foldUsage", () => {
  it("splits cached tokens out of OpenAI prompt_tokens", () => {
    expect(foldUsage(emptyUsage(), { prompt_tokens: 1000, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 600 } })).toEqual({
      inputTokens: 400,
      outputTokens: 50,
      cacheReadTokens: 600,
      cacheWriteTokens: 0,
    });
  });

  it("keeps the largest count when a stream repeats or grows it (Anthropic)", () => {
    let u = foldUsage(emptyUsage(), { input_tokens: 900, output_tokens: 1, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 });
    u = foldUsage(u, { output_tokens: 300 });
    expect(u).toEqual({ inputTokens: 900, outputTokens: 300, cacheReadTokens: 100, cacheWriteTokens: 20 });
  });
});

describe("usage ledger", () => {
  it("bills an OpenAI-shape stream from its final usage chunk, to the current project and user", async () => {
    setPrices({ "glm-5.3": { input: 1, output: 4 } });
    let sent: Record<string, unknown> = {};
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      sent = JSON.parse(String(init?.body));
      return sse([
        { choices: [{ delta: { content: "Hello" } }] },
        { choices: [{ delta: {}, finish_reason: "stop" }] },
        { choices: [], usage: { prompt_tokens: 2000, completion_tokens: 500, prompt_tokens_details: { cached_tokens: 1000 } } },
      ]);
    });
    const { events, off } = capture();
    await withCallContext({ projectId: "p1", userId: "u1" }, () =>
      generateCompletion([{ role: "user", content: "hi" }], { model: "glm-5.3", label: "script" })
    );
    off();
    expect(sent.stream_options).toEqual({ include_usage: true });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      projectId: "p1",
      userId: "u1",
      purpose: "script",
      model: "glm-5.3",
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 1000,
      estimated: false,
      ok: true,
    });
    // 1000 in + 1000 cached (priced as input) at $1/M, 500 out at $4/M
    expect(events[0].costUsd).toBeCloseTo(0.004, 6);
  });

  it("bills an Anthropic-shape stream from message_start + message_delta", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      sse([
        { type: "message_start", message: { usage: { input_tokens: 1200, output_tokens: 1, cache_read_input_tokens: 300 } } },
        { type: "content_block_delta", delta: { type: "text_delta", text: "Hi" } },
        { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 42 } },
      ])
    );
    const { events, off } = capture();
    await generateCompletion([{ role: "user", content: "hi" }], { model: "claude-sonnet-5-5" });
    off();
    expect(events[0]).toMatchObject({ inputTokens: 1200, outputTokens: 42, cacheReadTokens: 300, estimated: false, costUsd: null });
  });

  it("bills a failed attempt too, estimating when nothing was reported", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      sse([{ choices: [{ delta: { content: "x".repeat(350) } }] }, { choices: [{ delta: {}, finish_reason: "stop" }] }])
    );
    const { events, off } = capture();
    await expect(generateCompletion([{ role: "user", content: "hi" }], { model: "glm-5.3", maxTokens: 10 })).resolves.toBeDefined();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      sse([{ type: "content_block_delta", delta: { text: "y".repeat(70) } }, { type: "message_delta", delta: { stop_reason: "max_tokens" } }])
    );
    await expect(generateCompletion([{ role: "user", content: "hi" }], { model: "claude-sonnet-5-5" })).rejects.toThrow(/cut off/);
    off();
    expect(events.map((e) => [e.ok, e.estimated])).toEqual([
      [true, true],
      [false, true],
    ]);
    expect(events[1].outputTokens).toBe(20);
  });

  it("estimates an image at a typical vision cost, never by its base64 length", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => sse([{ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }]));
    const { events, off } = capture();
    // a ~140 KB screenshot, as the screenshot reader sends it
    const data = "A".repeat(140_000);
    await generateCompletion([{ role: "user", content: [{ type: "text", text: "x".repeat(350) }, { type: "image", mediaType: "image/jpeg", data }] }], { model: "qwen3.8-flash" });
    off();
    expect(events[0]).toMatchObject({ estimated: true, inputTokens: 100 + IMAGE_TOKENS });
  });

  it("does not bill a request the endpoint refused (429), only the retry that ran", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("slow down", { status: 429, headers: { "retry-after": "0.01" } }))
      .mockResolvedValueOnce(sse([{ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }, { choices: [], usage: { prompt_tokens: 10, completion_tokens: 2 } }]));
    const { events, off } = capture();
    await generateCompletion([{ role: "user", content: "hi" }], { model: "glm-5.3" });
    off();
    expect(events).toHaveLength(1);
  });

  it("keeps events when the sink fails and writes them on the next flush", async () => {
    await flushUsage(); // events from earlier tests
    const written: UsageEvent[] = [];
    let fail = true;
    setUsageSink(async (batch) => {
      if (fail) throw new Error("db down");
      written.push(...batch);
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => sse([{ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }]));
    await generateCompletion([{ role: "user", content: "hi" }], { model: "glm-5.3" });
    await flushUsage();
    expect(written).toHaveLength(0);
    fail = false;
    await flushUsage();
    expect(written).toHaveLength(1);
    setUsageSink(async () => undefined);
  });
});
