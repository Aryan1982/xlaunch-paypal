import { afterEach, describe, expect, it, vi } from "vitest";

/** config.ts as loaded with a Claude key (or none). */
const load = async (claudeKey: string) => {
  vi.resetModules();
  vi.stubEnv("CLAUDE_API_KEY", claudeKey);
  vi.stubEnv("VISION_MODEL", "qwen3.8-flash");
  return import("./config");
};

describe("effort on Claude 5.x", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  /** The body sent to Anthropic for one call (thinking off), from a fake stream that answers "ok". */
  const sentBody = async (effort?: string): Promise<Record<string, unknown>> => {
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
    await generateCompletion([{ role: "user", content: "hi" }], { model: "claude-opus-5-5", maxTokens: 50, effort });
    return body;
  };

  it("thinks at medium effort by default and at the requested effort otherwise", async () => {
    expect((await sentBody()).output_config).toEqual({ effort: "medium" });
    expect((await sentBody("low")).output_config).toEqual({ effort: "low" });
    const { CLAUDE_EFFORT } = await import("./config");
    expect(CLAUDE_EFFORT).toBe("medium");
    const body = await sentBody(CLAUDE_EFFORT);
    expect(body.thinking).toEqual({ type: "adaptive", display: "summarized" });
    expect(body.output_config).toEqual({ effort: "medium" });
  });
});
