/**
 * Token usage as the inference endpoint reports it, normalised across the two
 * wire shapes (lib: opencode.ts):
 *   - Anthropic /messages: `message_start.message.usage` (input, cache) and
 *     `message_delta.usage` (cumulative output); non-stream `usage`.
 *   - OpenAI /chat/completions: the last chunk's `usage` (needs
 *     `stream_options.include_usage`); `prompt_tokens` there INCLUDES cached
 *     tokens, which are split out here so input never double-counts.
 */
export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

export const emptyUsage = (): TokenUsage => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });

const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);

/**
 * Fold one reported `usage` object into `acc`. Streams repeat or grow the
 * counts (Anthropic's output count is cumulative), so each field keeps its
 * largest value rather than summing.
 */
export const foldUsage = (acc: TokenUsage, raw: unknown): TokenUsage => {
  if (!raw || typeof raw !== "object") return acc;
  const u = raw as Record<string, unknown>;
  let next: TokenUsage;
  if ("prompt_tokens" in u || "completion_tokens" in u) {
    const details = (u.prompt_tokens_details ?? {}) as Record<string, unknown>;
    const cached = n(details.cached_tokens ?? u.prompt_cache_hit_tokens);
    next = {
      inputTokens: Math.max(0, n(u.prompt_tokens) - cached),
      outputTokens: n(u.completion_tokens),
      cacheReadTokens: cached,
      cacheWriteTokens: 0,
    };
  } else {
    next = {
      inputTokens: n(u.input_tokens),
      outputTokens: n(u.output_tokens),
      cacheReadTokens: n(u.cache_read_input_tokens),
      cacheWriteTokens: n(u.cache_creation_input_tokens),
    };
  }
  return {
    inputTokens: Math.max(acc.inputTokens, next.inputTokens),
    outputTokens: Math.max(acc.outputTokens, next.outputTokens),
    cacheReadTokens: Math.max(acc.cacheReadTokens, next.cacheReadTokens),
    cacheWriteTokens: Math.max(acc.cacheWriteTokens, next.cacheWriteTokens),
  };
};

export const totalTokens = (u: TokenUsage): number => u.inputTokens + u.outputTokens + u.cacheReadTokens + u.cacheWriteTokens;

/**
 * What one image costs a vision model, roughly (a screenshot is about 1-2.5k
 * tokens across providers). Estimates count images at this, never by the
 * length of their base64 data, which would be ~20x too high.
 */
export const IMAGE_TOKENS = 1_600;

/** ~3.5 characters per token, plus each image at IMAGE_TOKENS: used only when the endpoint reports nothing. */
export const estimateUsage = (inChars: number, outChars: number, images = 0): TokenUsage => ({
  inputTokens: Math.ceil(inChars / 3.5) + images * IMAGE_TOKENS,
  outputTokens: Math.ceil(outChars / 3.5),
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
});
