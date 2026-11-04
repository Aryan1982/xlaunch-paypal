import { randomUUID } from "crypto";

import { CLAUDE_EFFORT, config, routeFor, thinksByDefault } from "./config";
import { Stopped, callContext, callLine, reportCall } from "./lib/calls";
import { recordTokens } from "./usage/ledger";
import { emptyUsage, estimateUsage, foldUsage, totalTokens, type TokenUsage } from "./usage/tokens";

export type ChatRole = "system" | "user" | "assistant";

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image"; mediaType: string; data: string /* base64 */ };

export type ChatMessage = {
  role: ChatRole;
  content: string | ContentPart[];
};

const textOf = (content: ChatMessage["content"]): string =>
  typeof content === "string"
    ? content
    : content
        .filter((p): p is Extract<ContentPart, { type: "text" }> => p.type === "text")
        .map((p) => p.text)
        .join("\n");

const toWire = (
  content: ChatMessage["content"],
  protocol: "openai" | "anthropic"
): unknown => {
  if (typeof content === "string") return content;
  return content.map((part) => {
    if (part.type === "text") return { type: "text", text: part.text };
    return protocol === "anthropic"
      ? {
          type: "image",
          source: { type: "base64", media_type: part.mediaType, data: part.data },
        }
      : {
          type: "image_url",
          image_url: { url: `data:${part.mediaType};base64,${part.data}` },
        };
  });
};

/**
 * Anthropic prompt caching (direct Claude calls): marks the system prompt and
 * the conversation so far, so a repair or revision that resends them reads
 * them from the cache (a tenth of the input price) instead of paying again.
 */
export const withCache = (body: Record<string, unknown>): void => {
  const mark = { type: "ephemeral" };
  if (typeof body.system === "string" && body.system) body.system = [{ type: "text", text: body.system, cache_control: mark }];
  const messages = body.messages as Array<{ role: string; content: unknown }>;
  const last = messages[messages.length - 1];
  if (!last) return;
  const parts = typeof last.content === "string" ? [{ type: "text", text: last.content }] : [...(last.content as Array<Record<string, unknown>>)];
  if (!parts.length) return;
  parts[parts.length - 1] = { ...parts[parts.length - 1], cache_control: mark };
  messages[messages.length - 1] = { ...last, content: parts };
};

/** Upstream inference failed at the HTTP level (non-2xx or unusable body). */
export class UpstreamError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "UpstreamError";
    this.status = status;
    this.body = body;
  }
}

/** The call itself failed (network, timeout, malformed response). */
export class InferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InferenceError";
  }
}

/** Abort reason when a stream goes quiet for longer than `idleTimeoutMs`. */
class IdleTimeout extends Error {
  constructor() {
    super("idle");
    this.name = "IdleTimeout";
  }
}

/** Set when the upstream model refuses a non-default temperature. */
const temperatureRejected = new Set<string>();
/** Models whose endpoint refuses `stream_options` (usage is then estimated). */
const streamOptionsRejected = new Set<string>();
/**
 * "Thinking off", as the least thinking each model accepts: "none", or when a
 * model refuses that, "minimal", then "low" (GLM 5.3 Flash started refusing
 * "none" on 12 Oct 2026: "this model always reasons". Sent nothing instead, it
 * thought ~19k characters and wrote no code; at "minimal" it thinks a line).
 * Learned per model from its 400s; past the last level the field is left out.
 */
const EFFORT_STEPS = ["none", "minimal", "low"] as const;
/**
 * Anthropic's advisor tool (a pairing such as Haiku writing with an Opus
 * advisor, config.advisorPair): the beta, the tool, and how long the stream
 * may sit idle while the advisor thinks (it does not stream; only pings arrive).
 */
const ADVISOR_BETA = "advisor-tool-2026-03-01";
const ADVISOR_IDLE_MS = 180_000;
/** A paused turn (stop_reason "pause_turn") is continued at most this many times. */
const MAX_RESUMES = 3;
const advisorTool = (model: string) => ({ type: "advisor_20260301", name: "advisor", model, max_uses: 2, max_tokens: 2048 });
export const ADVISOR_GUIDANCE = `

## The advisor

You can consult an \`advisor\` tool backed by a stronger model. It takes NO parameters: calling it forwards this whole conversation (the brief, the layout, any earlier code and notes) to the advisor. Call it once, before you write anything, after reading the brief: it advises on the approach, the layout and the risks. Then write your reply exactly as the brief asks (the code block, nothing else). Give its advice serious weight; where it conflicts with a hard rule of the brief, the brief wins. Call it again only if a fix you were asked for keeps failing.`;

/** What a call with the advisor tool saw: whether the advisor is working, its calls and errors, and the turn's content (to continue a paused turn). */
type AdvisorState = { model: string; pending: boolean; calls: number; errors: string[]; blocks: Array<Record<string, unknown>> };

/** How long a call may wait for its first byte (OPENCODE_FIRST_BYTE_MS). */
const FIRST_BYTE_MS = Number(process.env.OPENCODE_FIRST_BYTE_MS) > 0 ? Number(process.env.OPENCODE_FIRST_BYTE_MS) : 90_000;
const effortStep = new Map<string, number>();
/** The reasoning_effort to send a model for "thinking off", or null when it accepts none of them. */
export const offEffort = (model: string): string | null => EFFORT_STEPS[effortStep.get(model) ?? 0] ?? null;
/** The largest `max_tokens` a model accepts, learned from its 400 ("Range of max_tokens should be [1, 131072]"). */
const maxTokensCap = new Map<string, number>();
const capTokens = (model: string, requested: number): number => Math.min(requested, maxTokensCap.get(model) ?? requested);

/** The upper bound a "max_tokens out of range" error names, if this is one. */
export const maxTokensLimit = (text: string): number | null => {
  if (!/max_tokens|max_output_tokens|maximum.*tokens/i.test(text)) return null;
  const m =
    /\[\s*\d+\s*,\s*(\d+)\s*\]/.exec(text) ??
    // Anthropic: "max_tokens: 240000 > 128000, which is the maximum allowed ..."
    /max_tokens:\s*\d+\s*>\s*(\d+)/i.exec(text) ??
    /(?:at most|maximum(?: value)? (?:is|of)|<=|less than or equal to)\s*(\d{3,})/i.exec(text);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

const preview = (text: string, limit = 600): string =>
  text.length > limit ? `${text.slice(0, limit)}…` : text;

/**
 * Stable per-boot session id. OpenCode Go asks clients to send a stable
 * `x-opencode-session` (any UUID) so it can optimize routing and prompt
 * caching — the big shared prefix here is the skill file.
 */
const sessionId = process.env.OPENCODE_SESSION_ID ?? randomUUID();

/**
 * One call to the configured inference endpoint.
 *
 * Deliberately uses plain `fetch` — no SDK, no local service discovery. Both
 * the OpenAI (`/chat/completions`) and Anthropic (`/messages`) shapes are
 * supported because OpenCode Go serves different models through each.
 */
export async function generateCompletion(
  messages: ChatMessage[],
  options: CompletionCallbacks & {
    signal?: AbortSignal;
    maxTokens?: number;
    model?: string;
    attempt?: number;
    thinkingBudget?: number;
    effort?: string;
    label?: string;
    callAttempt?: number;
    note?: string;
    /** Internal: the assistant content of a paused turn (advisor), sent back to continue it. */
    resume?: Array<Record<string, unknown>>;
    /** Internal: how many times this turn has been continued. */
    resumes?: number;
  } = {}
): Promise<{ text: string; reasoning: string }> {
  const route = routeFor(options.model ?? config.model);
  const advising = route.protocol === "anthropic" && !!route.advisor;
  const started = Date.now();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": "my-video-server/1.0",
    "x-opencode-session": sessionId,
  };

  if (route.apiKey) {
    // OpenAI gateways use `Authorization: Bearer`; the Anthropic-style
    // `/messages` endpoint reads `x-api-key` instead.
    if (route.protocol === "anthropic") {
      headers["x-api-key"] = route.apiKey;
      // Required by api.anthropic.com, ignored by Anthropic-compatible gateways.
      headers["anthropic-version"] = config.anthropicVersion;
      if (advising) headers["anthropic-beta"] = ADVISOR_BETA;
    } else {
      headers.Authorization = `Bearer ${route.apiKey}`;
    }
  }

  // `system` is a top-level field in the Anthropic shape and a message in the
  // OpenAI shape — normalize here so callers just pass a message list.
  const system =
    messages
      .filter((message) => message.role === "system")
      .map((message) => textOf(message.content))
      .join("\n\n") + (advising ? ADVISOR_GUIDANCE : "");
  const rest = messages
    .filter((message) => message.role !== "system")
    .map((m) => ({ role: m.role, content: toWire(m.content, route.protocol) }));

  let body: Record<string, unknown>;

  if (route.protocol === "anthropic") {
    body = {
      model: route.model,
      max_tokens: capTokens(route.model, options.maxTokens ?? (config.maxTokens || 16384)), // required by /messages
      system,
      messages: rest,
    };
    if (route.cache) withCache(body);
    if (advising && route.advisor) body.tools = [advisorTool(route.advisor)];
    // a paused turn goes back as the assistant's message, unchanged, so the model continues it (after the cache mark)
    if (options.resume?.length) (body.messages as unknown[]).push({ role: "assistant", content: options.resume });

    if (route.thinkingMode === "adaptive") {
      // Claude 4.7+ / 5.x: `enabled` + budget_tokens is rejected with a 400.
      // `display` must be requested explicitly — 5.x defaults to "omitted",
      // which returns empty thinking blocks.
      body.thinking = {
        type: "adaptive",
        display: config.thinkingDisplay,
      };
      // the user's pick for this project wins over the call's own default
      const effort = callContext().effort ?? options.effort ?? config.effort;
      if (effort) {
        body.output_config = { effort };
      }
    } else if (
      route.thinkingMode === "enabled" &&
      config.thinkingBudget > 0
    ) {
      // Haiku 4.5 / Opus 4.5 / Sonnet 4.5 and earlier. A call can ask for a
      // smaller budget (planning calls), never below the API minimum.
      body.thinking = {
        type: "enabled",
        budget_tokens: Math.max(1024, Math.min(config.thinkingBudget, options.thinkingBudget ?? config.thinkingBudget)),
      };
    } else if (route.thinkingMode === "off" && thinksByDefault(route.model)) {
      // leaving thinking out would let it think unseen (config.thinksByDefault): think out loud,
      // at CLAUDE_EFFORT unless the call asks for another level
      body.thinking = { type: "adaptive", display: "summarized" };
      body.output_config = { effort: callContext().effort ?? options.effort ?? CLAUDE_EFFORT };
    } else if (
      route.thinkingMode === "disabled" ||
      route.thinkingMode === "between_tools"
    ) {
      // Explicitly reduce thinking. Note Claude Sonnet 5.5 rejects
      // "disabled"; its lowest setting is "between_tools".
      body.thinking = { type: route.thinkingMode };
    }

    // `temperature` must not be combined with thinking.
    if (!body.thinking && !temperatureRejected.has(route.model)) {
      body.temperature = config.temperature;
    }
  } else {
    body = {
      model: route.model,
      messages: messages.map((m) => ({
        role: m.role,
        content: toWire(m.content, "openai"),
      })),
    };
    if (!temperatureRejected.has(route.model)) body.temperature = config.temperature;
    // Thinking off means off: these models reason by default unless told not to (measured: it is
    // what made planning calls take minutes). `reasoning_effort: "none"` works across the gateway's models.
    const off = route.thinkingMode === "off" ? offEffort(route.model) : null;
    if (off) body.reasoning_effort = off;
    // Ask for token usage in the final chunk (the usage ledger bills from it).
    if (!streamOptionsRejected.has(route.model)) body.stream_options = { include_usage: true };
    const limit = options.maxTokens ?? config.maxTokens;
    if (limit > 0) {
      body.max_tokens = capTokens(route.model, limit);
    }
  }

  // Two limits: a hard cap on the whole call, and an idle limit that fires
  // when nothing arrives for a while (a stalled stream fails fast, a slow but
  // steady model is left alone). `touch()` is called on every received chunk.
  const timeout = AbortSignal.timeout(config.timeoutMs);
  const idle = new AbortController();
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const touch = (ms = config.idleTimeoutMs) => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => idle.abort(new IdleTimeout()), ms);
  };
  // the first byte may take longer than a pause mid-stream: a busy gateway queues a big prompt for a while
  // (all six 3D scenes were cut off at 30 s on 12 Oct while OpenCode answered slowly); once it streams, the idle limit applies
  touch(Math.max(config.idleTimeoutMs, FIRST_BYTE_MS));
  const stop = callContext().signal;
  const signal = AbortSignal.any([timeout, idle.signal, ...(options.signal ? [options.signal] : []), ...(stop ? [stop] : [])]);
  const failure = (error: unknown): Error | null => {
    if (stop?.aborted) return new Stopped();
    if (idle.signal.aborted) {
      return new InferenceError(`${route.model} stalled: nothing received for ${Math.round(config.idleTimeoutMs / 1000)}s.`);
    }
    if (timeout.aborted || (error instanceof Error && error.name === "TimeoutError")) {
      return new InferenceError(`Generation timed out after ${config.timeoutMs}ms against ${route.endpoint} (${route.model}).`);
    }
    return null;
  };

  let response: Response;

  try {
    response = await fetch(route.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...body, stream: true }),
      signal,
    });
  } catch (error) {
    clearTimeout(idleTimer);
    const known = failure(error);
    if (known) throw known;
    throw new InferenceError(
      `Could not reach ${route.endpoint}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  if (!response.ok) {
    clearTimeout(idleTimer);
    const text = await response.text();

    // Rate limits and gateway hiccups: back off and retry a few times.
    const attempt = options.attempt ?? 0;
    if ([429, 502, 503, 529].includes(response.status) && attempt < 3) {
      const after = Number(response.headers.get("retry-after"));
      const wait = Number.isFinite(after) && after > 0 ? after * 1000 : 2000 * 2 ** attempt;
      console.warn(`[llm] ${route.model} responded ${response.status}; retrying in ${Math.round(wait / 1000)}s`);
      await new Promise((r) => setTimeout(r, wait));
      return generateCompletion(messages, { ...options, attempt: attempt + 1 });
    }

    // Some models (e.g. Kimi) only accept their default temperature. Learn that
    // once, drop the parameter for every later call, and retry this one.
    // Decide on what THIS request sent, not on the shared flag: parallel calls
    // can all be rejected before the first one records the lesson.
    if (response.status === 400 && /temperature/i.test(text) && "temperature" in body) {
      if (!temperatureRejected.has(route.model)) {
        temperatureRejected.add(route.model);
        console.warn(`[llm] ${route.model} rejects a custom temperature; omitting it from now on`);
      }
      return generateCompletion(messages, options);
    }
    if (response.status === 400 && /reasoning_effort|reason/i.test(text) && "reasoning_effort" in body) {
      // step to the next level, deciding on what THIS request sent (parallel calls can all be refused at once)
      const sent = EFFORT_STEPS.indexOf(body.reasoning_effort as (typeof EFFORT_STEPS)[number]);
      if ((effortStep.get(route.model) ?? 0) <= sent) {
        effortStep.set(route.model, sent + 1);
        const next = offEffort(route.model);
        console.warn(`[llm] ${route.model} rejects reasoning_effort "${body.reasoning_effort}"; ${next ? `using "${next}"` : "leaving it out (it may think at length)"}`);
      }
      return generateCompletion(messages, options);
    }
    // A token cap above what the model allows: learn its limit once and retry under it.
    const cap = response.status === 400 ? maxTokensLimit(text) : null;
    if (cap !== null && typeof body.max_tokens === "number" && body.max_tokens > cap) {
      if (maxTokensCap.get(route.model) !== cap) {
        maxTokensCap.set(route.model, cap);
        console.warn(`[llm] ${route.model} accepts at most ${cap} output tokens; capping from now on`);
      }
      return generateCompletion(messages, options);
    }
    if (response.status === 400 && /stream_options|include_usage/i.test(text) && "stream_options" in body) {
      if (!streamOptionsRejected.has(route.model)) {
        streamOptionsRejected.add(route.model);
        console.warn(`[llm] ${route.model} rejects stream_options; usage will be estimated from text length`);
      }
      return generateCompletion(messages, options);
    }

    const hint =
      response.status === 401 || response.status === 403
        ? " Set OPENCODE_API_KEY in server/.env."
        : response.status === 404
          ? " Check OPENCODE_API_URL / OPENCODE_MODEL."
          : "";
    throw new UpstreamError(
      `${route.endpoint} responded ${response.status}${hint} — ${preview(text)}`,
      response.status,
      text
    );
  }

  // Tokens this call consumed, as reported by the endpoint (or estimated); every
  // attempt that got a response is billed, whether or not it succeeded.
  const meter: Meter = { usage: emptyUsage(), reported: false, outChars: 0 };
  const advisor: AdvisorState | undefined = advising && route.advisor ? { model: route.advisor, pending: false, calls: 0, errors: [], blocks: [] } : undefined;
  // the request's size for estimates: its text, and each image at a typical vision cost (never its base64 length)
  const inChars = system.length + messages.filter((m) => m.role !== "system").reduce((sum, m) => sum + textOf(m.content).length, 0);
  const images = messages.reduce((sum, m) => sum + (typeof m.content === "string" ? 0 : m.content.filter((p) => p.type === "image").length), 0);
  const purpose = options.label ?? (system.split("\n").find((l) => l.trim()) ?? "call").replace(/^#+\s*/, "").slice(0, 48).trim();
  const bill = (ok: boolean) => {
    recordTokens({
      model: route.model,
      purpose,
      usage: meter.reported ? meter.usage : estimateUsage(inChars, meter.outChars, images),
      estimated: !meter.reported,
      ok,
      ms: Date.now() - started,
    });
    // the advisor's tokens, at the advisor's price (usage.iterations; the top-level usage is the writer's only)
    if (meter.advisor && totalTokens(meter.advisor.usage) > 0) {
      recordTokens({ model: meter.advisor.model || route.advisor || route.model, purpose: `${purpose} (advisor)`, usage: meter.advisor.usage, estimated: false, ok, ms: Date.now() - started });
    }
  };

  const done = (result: { text: string; reasoning: string }) => {
    clearTimeout(idleTimer);
    bill(true);
    const chars = result.text.length + result.reasoning.length;
    const advised = advisor ? ` advisor=${route.advisor} calls=${advisor.calls}${advisor.errors.length ? ` errors=${advisor.errors.join(",")}` : ""}` : "";
    console.log(`[llm] model=${route.model} ${((Date.now() - started) / 1000).toFixed(0)}s out=~${Math.round(chars / 3.5 / 1000)}k tok${advised}`);
    // one line in the project's log (when a pipeline job is running): where the time goes
    const firstLine = (system.split("\n").find((l) => l.trim()) ?? "call").replace(/^#+\s*/, "").slice(0, 48).trim();
    reportCall(
      callLine({
        label: options.label ?? firstLine,
        model: route.model,
        ms: Date.now() - started,
        inChars,
        outChars: result.text.length,
        thinkChars: result.reasoning.length,
        attempt: options.callAttempt,
        note: [options.note, advisor?.calls ? `advisor ×${advisor.calls}` : ""].filter(Boolean).join(" · ") || undefined,
      })
    );
    return result;
  };

  let paused: { text: string; reasoning: string; paused?: Array<Record<string, unknown>> };
  try {
    // Some gateways ignore `stream` and answer with a plain JSON body.
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("event-stream")) {
      const result = extractCompletion(await response.text(), meter);
      if (result.reasoning) options.onReasoning?.(result.reasoning);
      if (result.text) options.onText?.(result.text);
      return done(result);
    }
    const result = await readCompletionStream(response, options, touch, signal, meter, advisor);
    if (!result.paused) return done(result);
    // this part is billed and logged here; its continuation is a call of its own
    done(result);
    paused = result;
  } catch (error) {
    clearTimeout(idleTimer);
    bill(false);
    throw failure(error) ?? error;
  }
  // the advisor paused the turn (stop_reason "pause_turn"): send it back as it is and let the model continue (no new user message)
  const resumes = options.resumes ?? 0;
  if (resumes >= MAX_RESUMES) throw new InferenceError(`${route.model}: the turn paused ${MAX_RESUMES + 1} times while the advisor worked; giving up.`);
  const more = await generateCompletion(messages, { ...options, attempt: 0, resume: [...(options.resume ?? []), ...(paused.paused ?? [])], resumes: resumes + 1 });
  return { text: paused.text + more.text, reasoning: [paused.reasoning, more.reasoning].filter(Boolean).join("\n\n") };
}

/** Usage seen while reading one response (`advisor`: the advisor's sub-calls, from usage.iterations). */
type Meter = { usage: TokenUsage; reported: boolean; outChars: number; advisor?: { model: string; usage: TokenUsage } };

const meterUsage = (meter: Meter | undefined, raw: unknown): void => {
  if (!meter || !raw || typeof raw !== "object") return;
  meter.usage = foldUsage(meter.usage, raw);
  meter.reported = true;
  // each report carries the whole list so far: the advisor's share is its sum, replaced each time
  const iterations = (raw as { iterations?: unknown }).iterations;
  if (Array.isArray(iterations)) {
    const calls = iterations.filter((it): it is Record<string, unknown> => !!it && typeof it === "object" && (it as { type?: unknown }).type === "advisor_message");
    if (calls.length) {
      meter.advisor = {
        model: String(calls[0].model ?? ""),
        usage: calls.reduce<TokenUsage>((sum, it) => {
          const u = foldUsage(emptyUsage(), it);
          return { inputTokens: sum.inputTokens + u.inputTokens, outputTokens: sum.outputTokens + u.outputTokens, cacheReadTokens: sum.cacheReadTokens + u.cacheReadTokens, cacheWriteTokens: sum.cacheWriteTokens + u.cacheWriteTokens };
        }, emptyUsage()),
      };
    }
  }
};

type CompletionCallbacks = {
  /** Called as reasoning/thinking tokens arrive. */
  onReasoning?: (chunk: string) => void;
  /** Called as answer tokens arrive. */
  onText?: (chunk: string) => void;
};

/**
 * Consume a server-sent-event completion, forwarding incremental reasoning so
 * callers can surface the model's thinking while it is still working.
 */
async function readCompletionStream(
  response: Response,
  options: CompletionCallbacks,
  onActivity: (ms?: number) => void = () => undefined,
  signal?: AbortSignal,
  meter?: Meter,
  advisor?: AdvisorState
): Promise<{ text: string; reasoning: string; paused?: Array<Record<string, unknown>> }> {
  const body = response.body;

  if (!body) {
    throw new InferenceError("The model returned an empty stream.");
  }

  const reader = body.getReader();
  // Wake a pending read when the call is aborted (idle or hard timeout). Cancelling the
  // reader alone does not always wake a read that is waiting on a frozen upstream (measured:
  // a stalled stream held the call for 16 minutes), so every read also races the abort.
  const cancel = () => void reader.cancel().catch(() => undefined);
  signal?.addEventListener("abort", cancel, { once: true });
  const aborted = new Promise<never>((_, reject) => {
    if (!signal) return;
    const fail = () => reject(signal.reason ?? new Error("aborted"));
    if (signal.aborted) fail();
    else signal.addEventListener("abort", fail, { once: true });
  });
  aborted.catch(() => undefined);
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let reasoning = "";
  let stopReason: string | null = null;

  const handleEvent = (data: string): void => {
    let event: unknown;
    try {
      event = JSON.parse(data);
    } catch {
      return; // keep-alive or partial payload
    }

    const chunk = event as {
      error?: { message?: string } | string;
      type?: string;
      usage?: unknown;
      message?: { usage?: unknown };
      index?: number;
      content_block?: Record<string, unknown> & { type?: string; name?: string; content?: { type?: string; text?: string; error_code?: string } };
      delta?: {
        type?: string;
        text?: unknown;
        thinking?: unknown;
        reasoning?: unknown;
        signature?: unknown;
        partial_json?: unknown;
        stop_reason?: string;
      };
      stop_reason?: string;
      choices?: Array<{
        finish_reason?: string | null;
        delta?: {
          content?: unknown;
          reasoning_content?: unknown;
          reasoning?: unknown;
        };
      }>;
    };

    if (chunk.error) {
      const message =
        typeof chunk.error === "string" ? chunk.error : chunk.error.message;
      throw new UpstreamError(
        `Model reported an error — ${message ?? "unknown"}`,
        200,
        data
      );
    }

    // Usage: Anthropic message_start (input) and message_delta (output); the
    // OpenAI final chunk (stream_options.include_usage).
    meterUsage(meter, chunk.message?.usage);
    meterUsage(meter, chunk.usage);

    // Anthropic /messages: the turn's blocks are kept (with the advisor tool) so a paused turn can be sent back as it was
    if (chunk.type === "content_block_start" && chunk.content_block) {
      const block = chunk.content_block;
      if (advisor) advisor.blocks[chunk.index ?? advisor.blocks.length] = JSON.parse(JSON.stringify(block)) as Record<string, unknown>;
      if (block.type === "server_tool_use" && block.name === "advisor" && advisor) {
        // the advisor does not stream: only pings until its answer arrives whole
        advisor.pending = true;
        advisor.calls += 1;
        onActivity(ADVISOR_IDLE_MS);
        options.onReasoning?.("\n\nConsulting the advisor…\n\n");
      } else if (block.type === "advisor_tool_result" && advisor) {
        advisor.pending = false;
        const result = block.content;
        if (result?.type === "advisor_tool_result_error") {
          advisor.errors.push(String(result.error_code ?? "unavailable"));
          options.onReasoning?.(`Advisor unavailable (${result.error_code ?? "error"}); continuing without it.\n\n`);
        } else if (result?.type === "advisor_result" && typeof result.text === "string") {
          options.onReasoning?.(`Advisor: ${result.text}\n\n`);
        } else {
          options.onReasoning?.("The advisor answered.\n\n");
        }
      } else if (block.type === "text" && text) {
        // a new text block after the advisor's answer starts on its own lines
        text += "\n\n";
      }
      return;
    }
    if (chunk.type === "content_block_stop" && advisor && typeof chunk.index === "number") {
      const block = advisor.blocks[chunk.index];
      if (block && typeof block._json === "string") {
        try {
          block.input = block._json ? JSON.parse(block._json) : {};
        } catch {
          block.input = {};
        }
        delete block._json;
      }
      return;
    }

    if (chunk.type === "content_block_delta" && chunk.delta && advisor && typeof chunk.index === "number") {
      const block = advisor.blocks[chunk.index];
      const d = chunk.delta;
      if (block) {
        if (typeof d.text === "string") block.text = String(block.text ?? "") + d.text;
        if (typeof d.thinking === "string") block.thinking = String(block.thinking ?? "") + d.thinking;
        if (typeof d.signature === "string") block.signature = String(block.signature ?? "") + d.signature;
        if (typeof d.partial_json === "string") block._json = String(block._json ?? "") + d.partial_json;
      }
    }

    if (chunk.type === "content_block_delta" && chunk.delta) {
      const thinking = chunk.delta.thinking ?? chunk.delta.reasoning;
      if (typeof thinking === "string" && thinking) {
        reasoning += thinking;
        if (meter) meter.outChars += thinking.length;
        options.onReasoning?.(thinking);
        return;
      }
      if (typeof chunk.delta.text === "string" && chunk.delta.text) {
        text += chunk.delta.text;
        if (meter) meter.outChars += chunk.delta.text.length;
        options.onText?.(chunk.delta.text);
      }
      return;
    }

    if (chunk.type === "message_delta" && chunk.delta?.stop_reason) {
      stopReason = chunk.delta.stop_reason;
      return;
    }

    if (chunk.stop_reason) stopReason = chunk.stop_reason;

    // OpenAI /chat/completions
    const choice = chunk.choices?.[0];
    if (!choice) return;

    if (choice.finish_reason) stopReason = choice.finish_reason;

    const delta = choice.delta ?? {};
    const deltaReasoning = delta.reasoning_content ?? delta.reasoning;

    if (typeof deltaReasoning === "string" && deltaReasoning) {
      reasoning += deltaReasoning;
      if (meter) meter.outChars += deltaReasoning.length;
      options.onReasoning?.(deltaReasoning);
    }

    const content = delta.content;
    if (typeof content === "string" && content) {
      text += content;
      if (meter) meter.outChars += content.length;
      options.onText?.(content);
    }
  };

  for (;;) {
    const { done, value } = await Promise.race([reader.read(), aborted]);
    if (done) break;
    // while the advisor works only pings arrive, about every 30 s: wait longer than the usual idle limit
    onActivity(advisor?.pending ? ADVISOR_IDLE_MS : undefined);

    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      handleEvent(data);
    }
  }

  signal?.removeEventListener("abort", cancel);
  if (signal?.aborted) throw signal.reason ?? new Error("aborted");

  if (stopReason === "pause_turn" && advisor) {
    return { text, reasoning: reasoning.trim(), paused: advisor.blocks.filter(Boolean) };
  }

  if (stopReason === "max_tokens" || stopReason === "length") {
    throw new InferenceError(
      "The model's reply was cut off at its length limit (it may have spent it thinking)."
    );
  }

  if (!text.trim()) {
    throw new InferenceError("Model returned an empty completion.");
  }

  // A stream that just stops, with no finish reason, was cut off upstream: the
  // text is a fragment (seen: a scene file ending mid-string). Never use it as if complete.
  if (stopReason === null) {
    throw new InferenceError("The reply was cut off mid-stream (the gateway closed it without finishing).");
  }

  return { text, reasoning: reasoning.trim() };
}

/**
 * Split a completion into the answer and the model's reasoning, supporting
 * both shapes:
 *   - Anthropic `/messages`: `content: [{type: "thinking"|"text", ...}]`
 *   - OpenAI `/chat/completions`: `message.reasoning_content` / `.reasoning`
 */
function extractCompletion(rawBody: string, meter?: Meter): {
  text: string;
  reasoning: string;
} {
  let payload: unknown;

  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw new InferenceError(
      `Model returned a non-JSON response — ${preview(rawBody)}`
    );
  }

  meterUsage(meter, (payload as { usage?: unknown } | null)?.usage);
  if (meter) meter.outChars = rawBody.length;

  const data = payload as {
    error?: { message?: string } | string;
    stop_reason?: string;
    choices?: Array<{
      message?: {
        content?: unknown;
        reasoning_content?: unknown;
        reasoning?: unknown;
      };
      text?: unknown;
    }>;
    content?: Array<{
      type?: string;
      text?: unknown;
      thinking?: unknown;
      reasoning?: unknown;
    }>;
  };

  if (data.error) {
    const message =
      typeof data.error === "string" ? data.error : data.error.message;
    throw new UpstreamError(
      `Model reported an error — ${message ?? preview(rawBody)}`,
      200,
      rawBody
    );
  }

  if (data.stop_reason === "max_tokens") {
    throw new InferenceError(
      "The model's reply was cut off at its length limit (it may have spent it thinking)."
    );
  }

  let text = "";
  let reasoning = "";

  if (Array.isArray(data.content)) {
    // Anthropic /messages
    for (const part of data.content) {
      const thinking = part?.thinking ?? part?.reasoning;
      if (typeof thinking === "string") {
        reasoning += thinking;
        continue;
      }
      if (typeof part?.text === "string") {
        text += part.text;
      }
    }
  } else {
    const choice = data.choices?.[0];
    const content = choice?.message?.content ?? choice?.text ?? "";

    text = Array.isArray(content)
      ? content
          .map((part) => {
            if (typeof part === "string") return part;
            if (part && typeof part === "object" && "text" in part) {
              const value = (part as { text?: unknown }).text;
              return typeof value === "string" ? value : "";
            }
            return "";
          })
          .join("")
      : typeof content === "string"
        ? content
        : "";

    const rawReasoning =
      choice?.message?.reasoning_content ?? choice?.message?.reasoning;
    reasoning = typeof rawReasoning === "string" ? rawReasoning : "";
  }

  if (!text.trim()) {
    throw new InferenceError(
      `Model returned an empty completion — ${preview(rawBody)}`
    );
  }

  return { text, reasoning: reasoning.trim() };
}
