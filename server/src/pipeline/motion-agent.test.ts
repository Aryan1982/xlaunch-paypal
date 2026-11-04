import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * A motion film's session signs in one way only: on the Claude Code login it
 * must never see an API key (it would bill the API), and on the API it must
 * never fall back to the login.
 */
describe("a motion film's agent sign-in", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  const load = async () => {
    vi.stubEnv("CLAUDE_API_KEY", "sk-test-key");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-from-the-shell");
    vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "oauth-token");
    return (await import("./motion-agent")).agentEnv;
  };

  it("uses the Claude Code login, with no API key in sight", async () => {
    const env = (await load())("claude-code");
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("oauth-token");
  });

  it("uses the API key, never the login", async () => {
    const env = (await load())("api");
    expect(env.ANTHROPIC_API_KEY).toBe("sk-test-key");
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
  });
});
