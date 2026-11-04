import { advisorPair, config, executorOf } from "../config";
import { VOICE_MODEL } from "../pipeline/voice";
import { onUsage, type UsageEvent } from "../usage/ledger";
import { charCost, priceFor, tokenCost, type ModelPrice } from "../usage/prices";

/**
 * Metered credits: work is charged for what its model calls actually cost.
 *
 *   credits = model cost (USD) x MARKUP x CREDITS_PER_USD   (+ VIDEO_FEE for a video)
 *
 * Before the work, an estimate is held (HOLD_FACTOR x the typical cost, which
 * is also the most it can charge); after it, the metered amount is charged
 * and the rest of the hold comes back. A cheap model makes cheap videos.
 */

/** What a credit sells for: the single pack, $19 for 1,400 credits. */
export const CREDITS_PER_USD = 1_400 / 19;
const num = (raw: string | undefined, fallback: number): number => {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
/** Credits charged per dollar of model cost, over what that dollar sells for (CREDIT_MARKUP, default 5). */
export const MARKUP = num(process.env.CREDIT_MARKUP, 5);
/** Flat credits per video: rendering, storage, site capture (VIDEO_FEE_CREDITS, default 25). */
export const VIDEO_FEE = num(process.env.VIDEO_FEE_CREDITS, 25);
/** The least a paid change costs, however little its calls cost. */
export const MIN_CHANGE = 5;
/** The hold is this many times the typical cost: room for a heavier run, and the cap on the charge. */
export const HOLD_FACTOR = 2.5;

/** A model with no price yet is metered as an expensive one (never undercharged). */
const UNPRICED: ModelPrice = { input: 5, output: 25 };

/** Credits for `usd` of model cost (at least 0). */
export const creditsFor = (usd: number): number => Math.max(0, Math.ceil(usd * MARKUP * CREDITS_PER_USD - 1e-9));

const costOf = (e: UsageEvent): number => {
  if (e.costUsd !== null) return e.costUsd;
  if (e.kind !== "llm") return 0;
  const p = UNPRICED;
  return ((e.inputTokens + e.cacheReadTokens + e.cacheWriteTokens) * p.input + e.outputTokens * p.output) / 1_000_000;
};

// Running model cost per project since this process started. Work on a project
// is exclusive, so the cost between two readings is that work's.
const spent = new Map<string, number>();
onUsage((e) => {
  if (e.projectId) spent.set(e.projectId, (spent.get(e.projectId) ?? 0) + costOf(e));
});

/** Model cost (USD) of a project's calls so far: read before and after a job for its cost. */
export const projectUsd = (projectId: string): number => spent.get(projectId) ?? 0;

// ---------------------------------------------------------------------------
// Estimates (typical tokens, measured on real films)
// ---------------------------------------------------------------------------

/**
 * Tokens per second of video, measured on the live 25 s films of 12 Oct 2026
 * (6 scenes: ~5k in / 8k code out per first write, then fixes and revisions
 * at 11-30k in each): the scene model (planning, writing, fixes, revisions)
 * and the rest (site reading, design review), about 200k in / 90k out and
 * 20k / 3k for a 25 s film.
 */
const PER_SECOND = { coder: { input: 8_000, output: 3_500 }, other: { input: 800, output: 120 } };
/** One scene rewritten by chat or regenerate: the scene model (the scene's conversation, the new code, its fixes), then its review. */
const PER_SCENE = { coder: { input: 40_000, output: 8_000 }, other: { input: 15_000, output: 1_000 } };

/**
 * Output is heavier on the gateway's models than on Claude: they think even
 * when asked not to (GLM wrote 8-26k tokens for a scene Claude writes in ~8k)
 * and get an extra design-review round (Claude gets CLAUDE_REVIEW_ROUNDS, 1).
 */
const OUTPUT_OVERHEAD = 1.5;
const overheadFor = (model: string) => (model.startsWith("claude-") ? 1 : OUTPUT_OVERHEAD);

const usdAt = (model: string, t: { input: number; output: number }): number => {
  const output = t.output * overheadFor(model);
  return (
    tokenCost(model, { inputTokens: t.input, outputTokens: output, cacheReadTokens: 0, cacheWriteTokens: 0 }) ??
    (t.input * UNPRICED.input + output * UNPRICED.output) / 1_000_000
  );
};

/**
 * A pairing's advisor reads the writer's conversation when it is consulted
 * (up to twice a call) and answers briefly: about half the writer's input and
 * a tenth of its output, at the advisor's price.
 */
const ADVISOR_SHARE = { input: 0.5, output: 0.1 };

const usdFor = (id: string, t: { input: number; output: number }): number => {
  const pair = advisorPair(id);
  const writer = usdAt(executorOf(id), t);
  return pair ? writer + usdAt(pair.advisor, { input: t.input * ADVISOR_SHARE.input, output: t.output * ADVISOR_SHARE.output }) : writer;
};

/**
 * Narration: ElevenLabs bills each character it voices. A 30 s voice-over is
 * ~75 words (~450 characters with its delivery tags); with a re-recorded line
 * now and then, about 20 characters a second of film.
 */
const NARRATION_CHARS_PER_SECOND = 20;
/** Typical model cost of a video's narration (the agent records it with scripts/voice.mjs, in VOICE_MODEL). */
export const narrationUsd = (seconds: number): number => charCost(VOICE_MODEL, Math.max(5, seconds) * NARRATION_CHARS_PER_SECOND) ?? 0;

/** The models a job uses: the one writing scenes, and the writer and reviewer around it. */
export type JobModels = { coder: string; writer?: string; vision?: string; narration?: boolean; motion?: boolean; film3d?: boolean };

/**
 * A motion film's agent session (pipeline/motion-agent.ts): measured on the
 * prompt-video studio's films (Opus, medium effort: $1.1-2.2 a film, 30-80
 * turns, most of the input from the prompt cache).
 */
const MOTION_TOKENS = { input: 150_000, output: 30_000 };
/**
 * A whole film, per second of it: a 30 s film's session (config.motion.seconds) takes about 300k input and 60k
 * output tokens (about twice the 10 s film sessions MOTION_TOKENS measured); another MOTION_SECONDS in proportion.
 */
const FILM_TOKENS_PER_SECOND = { input: 10_000, output: 2_000 };

/**
 * A 3D film's session against a 2D one: three.js worlds are longer code and
 * more review rounds (an estimate until 3D films are measured).
 */
const FILM_3D_FACTOR = 1.6;

/** Typical model cost of a change to a motion film. */
export const motionUsd = (m: JobModels): number => usdFor(m.coder, MOTION_TOKENS) * (m.film3d ? FILM_3D_FACTOR : 1);

/** Typical model cost of making a whole motion film `seconds` long. */
const filmUsd = (m: JobModels, seconds: number): number =>
  usdFor(m.coder, { input: FILM_TOKENS_PER_SECOND.input * seconds, output: FILM_TOKENS_PER_SECOND.output * seconds }) * (m.film3d ? FILM_3D_FACTOR : 1);

const otherUsd = (m: JobModels, t: { input: number; output: number }): number =>
  (usdFor(m.writer ?? config.models.writer, t) + usdFor(m.vision ?? config.models.vision, t)) / 2;

/** Typical model cost of a whole video. */
export const videoUsd = (m: JobModels, seconds: number): number => {
  if (m.motion) return filmUsd(m, seconds) + (m.narration ? narrationUsd(seconds) : 0);
  const s = Math.max(5, seconds);
  const scale = (t: { input: number; output: number }) => ({ input: t.input * s, output: t.output * s });
  return usdFor(m.coder, scale(PER_SECOND.coder)) + otherUsd(m, scale(PER_SECOND.other)) + (m.narration ? narrationUsd(s) : 0);
};

/** Typical model cost of rewriting one scene (chat or regenerate). */
export const sceneUsd = (m: JobModels): number => usdFor(m.coder, PER_SCENE.coder) + otherUsd(m, PER_SCENE.other);

/** A video's price: what it typically costs (shown), and what is held (the most it can cost). */
export const videoPrice = (m: JobModels, seconds: number): { estimate: number; hold: number } => {
  const usd = videoUsd(m, seconds);
  return { estimate: VIDEO_FEE + creditsFor(usd), hold: VIDEO_FEE + creditsFor(usd * HOLD_FACTOR) };
};

/** A change's price from its typical model cost. */
export const changePrice = (usd: number): { estimate: number; hold: number } => ({
  estimate: Math.max(MIN_CHANGE, creditsFor(usd)),
  hold: Math.max(MIN_CHANGE, creditsFor(usd * HOLD_FACTOR)),
});

/** What metered work comes to: its cost in credits plus any flat fee, never more than was held. */
export const meteredCredits = (usd: number, held: number, fee = 0): number => Math.min(held, fee + Math.max(fee ? 0 : MIN_CHANGE, creditsFor(usd)));

/** Whether a model has a known price (an unpriced one is metered at a high default). */
export const isPriced = (model: string): boolean => priceFor(model) !== null;
