import { afterEach, describe, expect, it, vi } from "vitest";

const load = async (key: string) => {
  vi.resetModules();
  vi.stubEnv("CLAUDE_API_KEY", key);
  return import("./config");
};

describe("the models on offer", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("are Sonnet 5.5 (the default) and Opus 5.5, and a pick goes to Anthropic with the Claude key", async () => {
    const { OFFERED_MODELS, DEFAULT_MODEL, coderModelFor, routeFor } = await load("sk-ant-test");
    expect(OFFERED_MODELS).toEqual([
      { id: "claude-sonnet-5-5", label: "Sonnet 5.5" },
      { id: "claude-opus-5-5", label: "Opus 5.5" },
    ]);
    expect(DEFAULT_MODEL).toBe("claude-sonnet-5-5");
    expect(coderModelFor("claude-opus-5-5")).toBe("claude-opus-5-5");
    expect(routeFor("claude-opus-5-5")).toMatchObject({ endpoint: "https://api.anthropic.com/v1/messages", protocol: "anthropic", apiKey: "sk-ant-test" });
    expect(routeFor("glm-5.3-flash").apiKey).not.toBe("sk-ant-test");
  });

  it("gives Sonnet for any other model asked for, while an older project's model still resolves", async () => {
    const { coderModelFor, motionModelFor } = await load("sk-ant-test");
    for (const other of ["claude-haiku-5-5", "glm-5.3-flash", "claude-haiku-5-5+opus-advisor", "", undefined]) expect(coderModelFor(other)).toBe("claude-sonnet-5-5");
    expect(motionModelFor("claude-haiku-5-5")).toBe("claude-haiku-5-5");
    expect(motionModelFor("claude-sonnet-5-5+full")).toBe("claude-sonnet-5-5");
  });

  it("runs Sonnet at high whatever is asked, and Opus at the effort asked for (high by default)", async () => {
    const { effortFor } = await load("sk-ant-test");
    expect(effortFor("claude-sonnet-5-5", "low")).toBe("high");
    expect(effortFor("claude-sonnet-5-5+full", "medium")).toBe("high");
    expect(effortFor(undefined, "low")).toBe("high");
    expect(effortFor("claude-opus-5-5", "low")).toBe("low");
    expect(effortFor("claude-opus-5-5", undefined)).toBe("high");
  });
});

describe("Claude token savings", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("caches the system prompt and the conversation so far", async () => {
    const { withCache } = await import("./opencode");
    const body: Record<string, unknown> = {
      system: "rules",
      messages: [
        { role: "user", content: "brief" },
        { role: "assistant", content: "code" },
        { role: "user", content: [{ type: "text", text: "fix these" }] },
      ],
    };
    withCache(body);
    expect(body.system).toEqual([{ type: "text", text: "rules", cache_control: { type: "ephemeral" } }]);
    const messages = body.messages as Array<{ content: unknown }>;
    expect(messages[2].content).toEqual([{ type: "text", text: "fix these", cache_control: { type: "ephemeral" } }]);
    expect(messages[0].content).toBe("brief");
  });

  it("caches Claude prompts only", async () => {
    const { routeFor } = await load("sk-ant-test");
    expect(routeFor("claude-opus-5-5").cache).toBe(true);
    expect(routeFor("glm-5.3-flash").cache).toBe(false);
  });
});

describe("Claude 5.x thinking", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  /** The body sent to Anthropic for one call, from a fake stream that answers "ok". */
  const sentBody = async (model: string): Promise<Record<string, unknown>> => {
    vi.stubEnv("OPENCODE_THINKING_MODE", "off");
    await load("sk-ant-test");
    const { generateCompletion } = await import("./opencode");
    let body: Record<string, unknown> = {};
    const sse = [
      'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":3,"output_tokens":1}}}',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}',
    ].join("\n\n") + "\n\n";
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      body = JSON.parse(init.body) as Record<string, unknown>;
      return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
    });
    await generateCompletion([{ role: "user", content: "hi" }], { model, maxTokens: 50 });
    return body;
  };

  it("with thinking off, asks a 5.x model for visible thinking at CLAUDE_EFFORT (it would otherwise think silently)", async () => {
    const body = await sentBody("claude-haiku-5-5");
    expect(body.thinking).toEqual({ type: "adaptive", display: "summarized" });
    expect(body.output_config).toEqual({ effort: "medium" });
    expect(body.temperature).toBeUndefined();
  });

  it("leaves older Claude models as they were (no thinking, a temperature)", async () => {
    const body = await sentBody("claude-haiku-4-5");
    expect(body.thinking).toBeUndefined();
    expect(body.temperature).toBeDefined();
  });
});
