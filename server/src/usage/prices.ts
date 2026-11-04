/**
 * Prices used to put a dollar figure on each usage event, in USD per million
 * tokens (and per 1k characters for speech). These are defaults for local
 * runs; in production the `model_prices` table overrides them (usage/ledger).
 * A model with no price is recorded with `costUsd: null` and the tokens still
 * count towards quotas.
 */
export type ModelPrice = {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  /** Speech models: USD per 1,000 characters. */
  perKChars?: number;
};

/**
 * ElevenLabs bills 1 credit a character (Eleven v3 and Multilingual v2). The
 * Starter plan is $5-6 a month for 30,000 credits: at the ceiling, $6 / 30k
 * characters = $0.20 per 1,000 (Oct 2026). The `model_prices` rows (db/008) say the same.
 */
const SPEECH_PER_K_CHARS = 0.2;
const DEFAULTS: Record<string, ModelPrice> = {
  eleven_v3: { input: 0, output: 0, perKChars: SPEECH_PER_K_CHARS },
  eleven_multilingual_v2: { input: 0, output: 0, perKChars: SPEECH_PER_K_CHARS },
};

const overrides = (): Record<string, ModelPrice> => {
  try {
    return process.env.MODEL_PRICES ? (JSON.parse(process.env.MODEL_PRICES) as Record<string, ModelPrice>) : {};
  } catch {
    console.warn("[usage] MODEL_PRICES is not valid JSON; ignoring it");
    return {};
  }
};

let table: Record<string, ModelPrice> = { ...DEFAULTS, ...overrides() };

/** Replace the price table (the ledger loads it from the database). */
export const setPrices = (prices: Record<string, ModelPrice>): void => {
  table = { ...DEFAULTS, ...overrides(), ...prices };
};

export const priceFor = (model: string): ModelPrice | null => table[model] ?? null;

export const tokenCost = (
  model: string,
  u: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }
): number | null => {
  const p = priceFor(model);
  if (!p) return null;
  const usd =
    (u.inputTokens * p.input +
      u.outputTokens * p.output +
      u.cacheReadTokens * (p.cacheRead ?? p.input) +
      u.cacheWriteTokens * (p.cacheWrite ?? p.input)) /
    1_000_000;
  return Math.round(usd * 1e6) / 1e6;
};

export const charCost = (model: string, chars: number): number | null => {
  const p = priceFor(model);
  if (!p?.perKChars) return null;
  return Math.round(((chars * p.perKChars) / 1000) * 1e6) / 1e6;
};
