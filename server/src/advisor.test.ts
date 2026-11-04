import { afterEach, describe, expect, it, vi } from "vitest";

const PAIR = "claude-haiku-5-5+opus-advisor";

/** Fresh modules with (or without) a Claude key, the pairing's config, its call layer and the usage ledger. */
const load = async (key: string) => {
  vi.resetModules();
  vi.stubEnv("CLAUDE_API_KEY", key);
  const config = await import("./config");
  const opencode = await import("./opencode");
  const ledger = await import("./usage/ledger");
  return { ...config, ...opencode, onUsage: ledger.onUsage };
};

/** An Anthropic stream from events (each `{ type, ... }`), pings included as the API sends them. */
const sse = (events: Array<Record<string, unknown>>): Response => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const e of events) controller.enqueue(encoder.encode(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
};

const text = (index: number, t: string) => [
  { type: "content_block_start", index, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index, delta: { type: "text_delta", text: t } },
  { type: "content_block_stop", index },
];

const advisorCall = (index: number) => [
  { type: "content_block_start", index, content_block: { type: "server_tool_use", id: "srvtoolu_1", name: "advisor", input: {} } },
  { type: "content_block_stop", index },
  { type: "ping" },
  { type: "content_block_start", index: index + 1, content_block: { type: "advisor_tool_result", tool_use_id: "srvtoolu_1", content: { type: "advisor_redacted_result", encrypted_content: "EqQB..." } } },
  { type: "content_block_stop", index: index + 1 },
];

const usage = {
  input_tokens: 1200,
  output_tokens: 900,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
  iterations: [
    { type: "message", input_tokens: 400, output_tokens: 20 },
    { type: "advisor_message", model: "claude-opus-5-5", input_tokens: 820, output_tokens: 1500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    { type: "message", input_tokens: 800, output_tokens: 880 },
  ],
};

describe("the retired Haiku + Opus advisor pairing", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("is no longer offered (a request for it gets Sonnet), but a project made with it still routes to Haiku with Opus advising", async () => {
    const { coderModelFor, routeFor, modelLabel } = await load("sk-ant-test");
    expect(coderModelFor(PAIR)).toBe("claude-sonnet-5-5");
    expect(routeFor(PAIR)).toMatchObject({ model: "claude-haiku-5-5", protocol: "anthropic", apiKey: "sk-ant-test", advisor: "claude-opus-5-5" });
    expect(routeFor("claude-haiku-5-5").advisor).toBeNull();
    expect(modelLabel(PAIR)).toMatch(/Opus 5.5 advisor/);
  });

  it("is never routed without a Claude key", async () => {
    const { routeFor } = await load("");
    expect(routeFor(PAIR).advisor).toBeNull();
  });

  it("sends the advisor tool with its beta, waits through the advisor, and bills its tokens at the advisor's model", async () => {
    const { generateCompletion, onUsage } = await load("sk-ant-test");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      sse([
        { type: "message_start", message: { usage: { input_tokens: 400, output_tokens: 1 } } },
        ...text(0, "Let me check with the advisor."),
        ...advisorCall(1),
        ...text(3, "```tsx\nexport const Scene = () => null;\n```"),
        { type: "message_delta", delta: { stop_reason: "end_turn" }, usage },
        { type: "message_stop" },
      ])
    );
    const seen: Array<{ model: string; purpose: string; outputTokens: number }> = [];
    const off = onUsage((e) => seen.push({ model: e.model, purpose: e.purpose, outputTokens: e.outputTokens }));
    const thoughts: string[] = [];
    const result = await generateCompletion(
      [
        { role: "system", content: "Write the scene." },
        { role: "user", content: "brief" },
      ],
      { model: PAIR, label: "scene", onReasoning: (t) => thoughts.push(t) }
    );
    off();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const headers = init.headers as Record<string, string>;
    expect(headers["anthropic-beta"]).toBe("advisor-tool-2026-03-01");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("claude-haiku-5-5");
    expect(body.tools).toEqual([{ type: "advisor_20260301", name: "advisor", model: "claude-opus-5-5", max_uses: 2, max_tokens: 2048 }]);
    expect(JSON.stringify(body.system)).toContain("## The advisor");

    // the text before and after the advisor, on separate lines; the code is all there
    expect(result.text).toBe("Let me check with the advisor.\n\n```tsx\nexport const Scene = () => null;\n```");
    expect(thoughts.join("")).toMatch(/Consulting the advisor/);
    // the writer's tokens at Haiku, the advisor's at Opus
    expect(seen).toContainEqual({ model: "claude-haiku-5-5", purpose: "scene", outputTokens: 900 });
    expect(seen).toContainEqual({ model: "claude-opus-5-5", purpose: "scene (advisor)", outputTokens: 1500 });
  });

  it("keeps a plain Claude call free of the advisor", async () => {
    const { generateCompletion } = await load("sk-ant-test");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      sse([...text(0, "ok"), { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2 } }])
    );
    await generateCompletion([{ role: "user", content: "hi" }], { model: "claude-haiku-5-5" });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["anthropic-beta"]).toBeUndefined();
    expect(JSON.parse(String(init.body)).tools).toBeUndefined();
  });

  it("continues a turn the advisor paused, sending it back unchanged with no new user message", async () => {
    const { generateCompletion } = await load("sk-ant-test");
    const replies = [
      sse([
        ...text(0, "Planning."),
        { type: "content_block_start", index: 1, content_block: { type: "server_tool_use", id: "srvtoolu_9", name: "advisor", input: {} } },
        { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "{}" } },
        { type: "content_block_stop", index: 1 },
        { type: "message_delta", delta: { stop_reason: "pause_turn" }, usage: { output_tokens: 5 } },
      ]),
      sse([
        ...advisorCall(0),
        ...text(2, "```tsx\ncode\n```"),
        { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 40 } },
      ]),
    ];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => replies.shift()!);
    const result = await generateCompletion([{ role: "user", content: "brief" }], { model: PAIR });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const second = JSON.parse(String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body));
    const last = second.messages[second.messages.length - 1];
    expect(last.role).toBe("assistant");
    expect(last.content).toEqual([
      { type: "text", text: "Planning." },
      { type: "server_tool_use", id: "srvtoolu_9", name: "advisor", input: {} },
    ]);
    expect(second.messages[second.messages.length - 2].role).toBe("user");
    expect(second.tools?.[0]?.type).toBe("advisor_20260301");
    expect(result.text).toBe("Planning.```tsx\ncode\n```");
  });

  it("carries on when the advisor is unavailable", async () => {
    const { generateCompletion } = await load("sk-ant-test");
    const thoughts: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      sse([
        { type: "content_block_start", index: 0, content_block: { type: "server_tool_use", id: "s", name: "advisor", input: {} } },
        { type: "content_block_stop", index: 0 },
        { type: "content_block_start", index: 1, content_block: { type: "advisor_tool_result", tool_use_id: "s", content: { type: "advisor_tool_result_error", error_code: "overloaded" } } },
        { type: "content_block_stop", index: 1 },
        ...text(2, "```tsx\ncode\n```"),
        { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 4 } },
      ])
    );
    const result = await generateCompletion([{ role: "user", content: "brief" }], { model: PAIR, onReasoning: (t) => thoughts.push(t) });
    expect(result.text).toBe("```tsx\ncode\n```");
    expect(thoughts.join("")).toMatch(/Advisor unavailable \(overloaded\)/);
  });
});

describe("the retired Sonnet 5.5 setup", () => {
  const FULL = "claude-sonnet-5-5+full";
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("is no longer offered, but a project made with it still routes to Sonnet with no advisor tool", async () => {
    const { coderModelFor, routeFor, modelLabel } = await load("sk-ant-test");
    expect(coderModelFor(FULL)).toBe("claude-sonnet-5-5");
    expect(routeFor(FULL)).toMatchObject({ model: "claude-sonnet-5-5", protocol: "anthropic", advisor: null });
    expect(modelLabel(FULL)).toBe("Claude Sonnet 5.5");
  });

  it("sends a call for this model to Sonnet, without the advisor beta", async () => {
    const { generateCompletion } = await load("sk-ant-test");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      sse([...text(0, "{}"), { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2 } }])
    );
    await generateCompletion([{ role: "user", content: "profile" }], { model: FULL });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body)).model).toBe("claude-sonnet-5-5");
    expect((init.headers as Record<string, string>)["anthropic-beta"]).toBeUndefined();
    expect(JSON.parse(String(init.body)).tools).toBeUndefined();
  });
});

describe("the effort the user picks for a project", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("goes to every Claude call the project's job makes, over the call's own default", async () => {
    const { generateCompletion } = await load("sk-ant-test");
    const { withCallContext } = await import("./lib/calls");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      sse([...text(0, "ok"), { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2 } }])
    );
    const effortOf = (i: number) => JSON.parse(String((fetchMock.mock.calls[i] as [string, RequestInit])[1].body)).output_config?.effort;
    // a scene call asks for its own default; the project's pick wins
    await withCallContext({ projectId: "p1", effort: "high" }, () => generateCompletion([{ role: "user", content: "x" }], { model: "claude-haiku-5-5", effort: "medium" }));
    expect(effortOf(0)).toBe("high");
    // with no pick, the call's default stands
    await generateCompletion([{ role: "user", content: "x" }], { model: "claude-haiku-5-5", effort: "low" });
    expect(effortOf(1)).toBe("low");
    // a model that takes no effort gets none
    await withCallContext({ effort: "high" }, () => generateCompletion([{ role: "user", content: "x" }], { model: "glm-5.3-flash" }));
    expect(effortOf(2)).toBeUndefined();
  });
});
