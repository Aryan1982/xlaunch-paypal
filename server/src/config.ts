import path from "path";

/**
 * Environment + path configuration for the video API.
 *
 * Env lives in `server/.env` (loaded regardless of where the process is
 * started from). Project paths still use `process.cwd()`, matching the
 * assumption `src/index.ts` makes for `projects/` and `public/bundles/`.
 */
function loadEnvFiles(): void {
  // The first hit wins; Node does not override variables that are already set.
  const candidates = [
    path.resolve(process.cwd(), ".env"), // `npm run dev` from server/
    path.resolve(__dirname, "..", ".env"), // server/.env from any cwd
    path.resolve(__dirname, "..", "..", ".env"), // repo-root .env (e.g. ELEVENLABS_KEY)
  ];

  for (const file of candidates) {
    try {
      process.loadEnvFile(file);
    } catch {
      // Missing or unreadable env file — fall back to the process environment.
    }
  }
}

loadEnvFiles();

const num = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/**
 * Models that OpenCode Go serves through the Anthropic-style `/messages`
 * endpoint (see https://opencode.ai/docs/go). Everything else on
 * `/chat/completions` speaks the OpenAI shape.
 */
const MESSAGES_MODELS = /^(minimax-|qwen3\.8-max$|qwen3\.7-plus$)/;

const resolveEndpoint = (
  url: string,
  model: string
): { endpoint: string; protocol: "openai" | "anthropic" } => {
  if (url.endsWith("/messages")) {
    return { endpoint: url, protocol: "anthropic" };
  }

  if (url.endsWith("/chat/completions") && MESSAGES_MODELS.test(model)) {
    return {
      endpoint: url.replace(/\/chat\/completions$/, "/messages"),
      protocol: "anthropic",
    };
  }

  return { endpoint: url, protocol: "openai" };
};

const DEFAULT_WRITER = "qwen3.8-flash";
const DEFAULT_CODER = "glm-5.3-flash";

const resolved = resolveEndpoint(
  process.env.OPENCODE_API_URL ??
    "https://opencode.ai/zen/go/v1/chat/completions",
  process.env.OPENCODE_MODEL ?? DEFAULT_WRITER
);

/** The writing model: profile, brief, script, chat planning. Fast and cheap. */
const model = process.env.OPENCODE_MODEL ?? DEFAULT_WRITER;
const maxTokens = num(process.env.OPENCODE_MAX_TOKENS, 16384);

/**
 * Claude 4.7+ and the 5.x models reject `thinking.type: "enabled"` with a 400
 * and require adaptive thinking instead. Haiku 4.5 / Opus 4.5 / Sonnet 4.5 and
 * earlier only support the manual `enabled` mode.
 */
const ADAPTIVE_THINKING_ONLY =
  /claude-(?:opus|sonnet)-(?:4-(?:7|8)|5(?:-5)?)(?:$|[-.])|claude-haiku-5|claude-(?:fable|mythos)-5/;

/**
 * Claude 5.x models think by default when a request leaves thinking out
 * (adaptive, "medium" effort on Haiku and Opus 5.5), and show nothing of it
 * (display "omitted"): a 3D scene could think silently past the 30 s idle
 * limit and be cut off as "stalled". For these, "thinking off" is sent as
 * adaptive thinking at low effort with a summarized display, so they think
 * little and the stream is never silent while they do.
 */
export const thinksByDefault = (model: string): boolean => /claude-(?:opus|sonnet|haiku)-5|claude-(?:fable|mythos)-5/.test(model);

const thinkingBudgetRaw = (() => {
  const requested = Number(process.env.OPENCODE_THINKING_BUDGET ?? 2000);
  if (!Number.isFinite(requested) || requested <= 0) return 0;
  return Math.min(requested, Math.max(1024, maxTokens - 2048));
})();

type ThinkingMode = "off" | "enabled" | "adaptive" | "disabled" | "between_tools";

const thinkingModeFor = (model: string): ThinkingMode => {
  // Off by default: planning and scene calls decide once instead of deliberating in loops.
  const requested = (process.env.OPENCODE_THINKING_MODE ?? "off").toLowerCase();
  if (
    requested === "off" ||
    requested === "enabled" ||
    requested === "adaptive" ||
    requested === "disabled" ||
    requested === "between_tools"
  ) {
    return requested;
  }
  // auto: pick whatever the configured model actually accepts.
  if (ADAPTIVE_THINKING_ONLY.test(model)) return "adaptive";
  return thinkingBudgetRaw > 0 ? "enabled" : "off";
};
const thinkingMode = thinkingModeFor(model);

const apiUrl = process.env.OPENCODE_API_URL ?? "https://opencode.ai/zen/go/v1/chat/completions";

/**
 * Claude models go straight to Anthropic's API with their own key
 * (CLAUDE_API_KEY), whatever gateway serves the other models.
 */
const claudeKey = (process.env.CLAUDE_API_KEY ?? "").trim();
const claudeUrl = process.env.CLAUDE_API_URL ?? "https://api.anthropic.com/v1/messages";
const isClaude = (m: string) => Boolean(claudeKey) && m.startsWith("claude-");
/** The Anthropic API key and base URL for a motion film's agent signed in with the API (config.motion.runner). */
export const claudeApi = (): { key: string; baseUrl: string | null } => {
  const origin = new URL(claudeUrl).origin;
  return { key: claudeKey, baseUrl: origin === "https://api.anthropic.com" ? null : origin };
};

/** A motion film's agent model: the project's Claude model (the model behind a retired setup id), else config.motion.model ("opus"). */
export const motionModelFor = (requested: string | undefined): string => {
  const model = executorOf(requested ?? "");
  return model.startsWith("claude-") ? model : config.motion.model;
};

/**
 * The models on offer, everywhere (the composer's 2D and 3D films, chat, the
 * paywall, the price list, /models and so the MCP tools): Sonnet 5.5, the
 * default, and Opus 5.5. Not configurable: projects made with any other model
 * still resolve (executorOf, motionModelFor), but a request for one gets Sonnet.
 */
export const SONNET = "claude-sonnet-5-5";
export const OPUS = "claude-opus-5-5";
export const OFFERED_MODELS: ReadonlyArray<{ id: string; label: string }> = [
  { id: SONNET, label: "Sonnet 5.5" },
  { id: OPUS, label: "Opus 5.5" },
];
export const DEFAULT_MODEL = SONNET;

/**
 * Setups no longer offered, kept so projects made with them still resolve:
 * calls go to `executor` (with `advisor` advising through Anthropic's advisor
 * tool, platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool).
 */
type DevModel = { executor: string; advisor?: string; label: string };
const DEV_MODELS: Record<string, DevModel> = {
  "claude-haiku-5-5+opus-advisor": { executor: "claude-haiku-5-5", advisor: "claude-opus-5-5", label: "Claude Haiku 5.5 + Opus 5.5 advisor" },
  "claude-sonnet-5-5+full": { executor: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
};
/** The writer and advisor behind an advisor pairing, or null for any other model. */
export const advisorPair = (id: string): { executor: string; advisor: string } | null => {
  const d = DEV_MODELS[id];
  return d?.advisor ? { executor: d.executor, advisor: d.advisor } : null;
};
/** The model that actually writes for `id` (itself, unless it is a retired setup). */
export const executorOf = (id: string): string => DEV_MODELS[id]?.executor ?? id;
const isDevModel = (id: string | undefined): id is string => !!claudeKey && !!id && id in DEV_MODELS;

/** Where and how to call `model`: endpoint, wire protocol, key and thinking mode (and the advisor, for a pairing). */
export const routeFor = (m: string) => {
  const pair = isDevModel(m) ? DEV_MODELS[m] : null;
  const id = pair ? pair.executor : m;
  return isClaude(id)
    ? { model: id, endpoint: claudeUrl, protocol: "anthropic" as const, apiKey: claudeKey, thinkingMode: thinkingModeFor(id), cache: true, advisor: pair?.advisor ?? (null as string | null) }
    : { model: id, ...resolveEndpoint(apiUrl, id), apiKey: process.env.OPENCODE_API_KEY ?? "", thinkingMode: thinkingModeFor(id), cache: false, advisor: null as string | null };
};

/** "claude-opus-5-5" -> "Claude Opus 5.5" */
const claudeLabel = (m: string) =>
  m.replace(/-\d{8}$/, "").split("-").map((w, i) => (i === 0 || /^[a-z]/.test(w) ? w[0].toUpperCase() + w.slice(1) : w)).join(" ").replace(/(\d) (\d)/g, "$1.$2");

/** A model's name for people: its label on offer, else a readable form of its id. */
export const modelLabel = (id: string): string =>
  OFFERED_MODELS.find((m) => m.id === id)?.label ?? DEV_MODELS[id]?.label ?? (id.startsWith("claude-") ? claudeLabel(id) : id);

/**
 * The writer (OPENCODE_MODEL) does the text jobs; a project's own model
 * (one of OFFERED_MODELS, DEFAULT_MODEL unless picked) makes its film.
 * `vision` reads screenshots (VISION_MODEL, else the writer).
 */
const models = {
  writer: model,
  coder: DEFAULT_MODEL,
  vision: process.env.VISION_MODEL || model,
};

/** 3D videos for everyone (ENABLE_3D=1); otherwise only admins can make them while 3D is tested. */
export const threeDOpen = (): boolean => process.env.ENABLE_3D === "1";

/**
 * GL backend for headless Chrome (exports and test renders), by the video's
 * mode. "angle" draws on the GPU (a Mac). A Linux server without a GPU needs
 * "swangle" (SwiftShader: WebGL on the CPU) for 3D, or WebGL can't start at
 * all, but it makes every frame go through the software GL path: on the
 * 2-core VPS a 2D video rendered at 1.6 fps with it and 8.1 fps without
 * (scripts/render-bench.ts, 12 Oct 2026), so 2D uses Chrome's default there.
 * RENDER_GL overrides both; empty means Chrome's default.
 */
export const renderGl = (mode: "2d" | "3d" = "3d"): "angle" | "swangle" | "egl" | "swiftshader" | "vulkan" | "angle-egl" | null => {
  const set = process.env.RENDER_GL;
  if (set !== undefined) return (set || null) as ReturnType<typeof renderGl>;
  if (process.platform === "darwin") return "angle";
  return mode === "3d" ? "swangle" : null;
};

/** The model a request asked for when it is on offer; anything else (or nothing) gets the default, Sonnet 5.5. */
export const coderModelFor = (requested: string | undefined): string =>
  requested && OFFERED_MODELS.some((m) => m.id === requested) ? requested : DEFAULT_MODEL;

/**
 * The effort a project's film runs at: Sonnet 5.5 always at high, whatever was
 * asked; any other model at the effort asked for, high by default.
 */
export const effortFor = <E extends string>(model: string | undefined, requested: E | undefined): E | "high" =>
  executorOf(model || DEFAULT_MODEL) === SONNET ? "high" : (requested ?? "high");

/**
 * `output_config.effort` for every call to a Claude 5.x model (CLAUDE_EFFORT,
 * default "medium", Opus 5.5's own default): scenes, revisions, review and
 * planning. Other models ignore it.
 */
export const CLAUDE_EFFORT = (process.env.CLAUDE_EFFORT || "medium").toLowerCase();
/**
 * Adaptive thinking returns an empty `thinking` field unless summarized
 * display is requested (it is the default only on 4.6-and-earlier models).
 */
const thinkingDisplay =
  (process.env.OPENCODE_THINKING_DISPLAY ?? "summarized").toLowerCase() ===
  "omitted"
    ? "omitted"
    : "summarized";

const effort = (process.env.OPENCODE_EFFORT ?? "").toLowerCase();

export const config = {
  /** Express port. Matches the port `src/index.ts` already listens on. */
  port: num(process.env.PORT, 3001),
  /** Interface to listen on. Loopback by default: the web app proxies /api here. */
  host: process.env.HOST || "127.0.0.1",

  /** OpenAI-compatible chat completions endpoint, as configured. */
  apiUrl:
    process.env.OPENCODE_API_URL ??
    "https://opencode.ai/zen/go/v1/chat/completions",

  /** The endpoint actually called, with the protocol it speaks. */
  endpoint: resolved.endpoint,
  protocol: resolved.protocol,
  /** Model name sent to `OPENCODE_API_URL`. */
  model,

  /** The writer, the default film model and the vision model. */
  models,

  /**
   * Required by the real Anthropic API; harmless for Anthropic-compatible
   * gateways (opencode zen, proxies, ...).
   */
  anthropicVersion: process.env.OPENCODE_ANTHROPIC_VERSION ?? "2023-06-01",

  /** Bearer token for `OPENCODE_API_URL`. Omit for gateways that need none. */
  apiKey: process.env.OPENCODE_API_KEY ?? "",

  temperature: num(process.env.OPENCODE_TEMPERATURE, 0.4),

  /** 0 disables the parameter entirely (for gateways that reject it). */
  maxTokens,

  /**
   * Anthropic-style thinking. `adaptive` is the only mode accepted by
   * Claude 4.7+ / 5.x; `enabled` (with `thinkingBudget`) suits Haiku 4.5 and
   * the 4.5/4.6 generation; `off` sends no thinking config at all.
   */
  thinkingMode,
  thinkingBudget: thinkingBudgetRaw,
  thinkingDisplay,

  /** `output_config.effort` for adaptive thinking: low | medium | high. (With thinking off, a 5.x Claude call gets its own `effort`, else "low".) */
  effort,

  /** Abort a generation that has not finished within this window. */
  timeoutMs: num(process.env.OPENCODE_TIMEOUT_MS, 900_000),

  /** Abort a call when nothing has streamed in for this long (a frozen model). With thinking off a healthy stream never pauses this long. */
  idleTimeoutMs: num(process.env.OPENCODE_IDLE_TIMEOUT_MS, 30_000),

  /** All persistent state: projects, assets, generated source, renders. */
  dataDir: path.resolve(__dirname, "..", "data"),

  /** Public origin of this server, used by the renderer to fetch assets. */
  publicUrl: process.env.PUBLIC_URL ?? `http://127.0.0.1:${num(process.env.PORT, 3001)}`,

  /**
   * The app's address as users reach it (https://app.xlaunch.pro), for links
   * handed out of the app such as signed download URLs. Falls back to
   * publicUrl, which is only right for local development.
   */
  appOrigin: (process.env.APP_ORIGIN ?? process.env.PUBLIC_URL ?? `http://127.0.0.1:${num(process.env.PORT, 3001)}`).replace(/\/+$/, ""),

  /**
   * Motion films are made by a Claude agent session in a Remotion workspace
   * (server/motion-studio, src/pipeline/motion-agent.ts). MOTION_RUNNER is how a
   * new film's session signs in unless the user picks: "claude-code" (the
   * Claude Code login, CLAUDE_CODE_OAUTH_TOKEN or `claude login`) or "api"
   * (CLAUDE_API_KEY). Same session, tools and prompts either way.
   */
  motion: {
    runner: (process.env.MOTION_RUNNER === "api" ? "api" : "claude-code") as "claude-code" | "api",
    /**
     * Accounts that aren't admins whose films still run on the Claude Code login (MOTION_SUBSCRIPTION_ACCOUNTS,
     * comma-separated emails): the owner's own customer account, for trying previews without spending API
     * credits. Their films keep the shell-less tools; only admins get a shell.
     */
    subscriptionAccounts: (process.env.MOTION_SUBSCRIPTION_ACCOUNTS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
    /**
     * Accounts that pick either model (and Opus's effort) even for a free preview (MOTION_MODEL_PICKER_ACCOUNTS,
     * comma-separated emails): the owner's own customer account, for comparing models. Everyone else's
     * free preview is made with previewModel at high effort.
     */
    modelPickerAccounts: (process.env.MOTION_MODEL_PICKER_ACCOUNTS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
    /** The model when the project's isn't a Claude model ("opus" = the newest Opus the login can use). */
    model: process.env.MOTION_MODEL || "opus",
    /** Every film's length in seconds (MOTION_SECONDS); it may run up to 5 s longer for its ending to settle. */
    seconds: Math.min(60, Math.max(3, num(process.env.MOTION_SECONDS, 30))),
    /** A free preview: the whole film planned and only its first previewSeconds built, in the same session. */
    previewSeconds: Math.min(30, Math.max(3, num(process.env.MOTION_PREVIEW_SECONDS, 10))),
    /**
     * The free preview's model, whatever the user picked (it becomes the project's model, so the app shows it, and
     * finishes the film): one of OFFERED_MODELS (MOTION_PREVIEW_MODEL), Sonnet by default. An Opus preview and finish
     * cost ~$9 a film (24 Oct test), more than the $15 One video pack can carry with free previews that don't convert.
     */
    previewModel: coderModelFor(process.env.MOTION_PREVIEW_MODEL),
    fps: Math.min(60, Math.max(24, num(process.env.MOTION_FPS, 60))),
    maxTurns: num(process.env.MOTION_MAX_TURNS, 150),
  },
} as const;

export type Config = typeof config;
