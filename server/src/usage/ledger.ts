import fs from "fs/promises";
import path from "path";

import { config } from "../config";
import { callContext } from "../lib/calls";
import { charCost, tokenCost } from "./prices";
import { totalTokens, type TokenUsage } from "./tokens";

/**
 * The usage ledger: one event per model call (every attempt, failed ones
 * included, since they are billed too) and per speech take. Events are
 * buffered and written in batches by the sink: a JSONL file locally, the
 * `usage_events` table once the database is configured (setUsageSink).
 */
export type UsageEvent = {
  at: number;
  userId: string | null;
  projectId: string | null;
  /** What the call was for: "script", "scene s3", "voice take"... */
  purpose: string;
  kind: "llm" | "tts" | "video";
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  ttsChars: number;
  /** null when the model has no price (usage/prices.ts). */
  costUsd: number | null;
  /** True when the endpoint reported no usage and tokens were estimated from text length. */
  estimated: boolean;
  ok: boolean;
  ms: number;
};

export type UsageSink = (events: UsageEvent[]) => Promise<void>;

const fileSink: UsageSink = async (events) => {
  await fs.mkdir(config.dataDir, { recursive: true });
  await fs.appendFile(path.join(config.dataDir, "usage.jsonl"), events.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
};

// Test runs never write to the real ledger.
let sink: UsageSink = process.env.VITEST ? async () => undefined : fileSink;
let buffer: UsageEvent[] = [];
let timer: NodeJS.Timeout | null = null;
let flushing: Promise<void> | null = null;
const listeners = new Set<(e: UsageEvent) => void>();

const FLUSH_MS = 2_000;
const MAX_BUFFER = 5_000;

export const setUsageSink = (next: UsageSink): void => {
  sink = next;
};

/** Called for every event as it is recorded (quota counters, live meters). */
export const onUsage = (fn: (e: UsageEvent) => void): (() => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const flushUsage = async (): Promise<void> => {
  if (timer) clearTimeout(timer);
  timer = null;
  await flushing;
  if (buffer.length === 0) return;
  const batch = buffer;
  buffer = [];
  flushing = sink(batch)
    .catch((error) => {
      console.error(`[usage] could not write ${batch.length} events; keeping them for the next flush:`, error);
      buffer = [...batch, ...buffer].slice(-MAX_BUFFER);
    })
    .finally(() => {
      flushing = null;
    });
  await flushing;
};

const schedule = () => {
  if (!timer) timer = setTimeout(() => void flushUsage(), FLUSH_MS);
};

const push = (event: UsageEvent) => {
  buffer.push(event);
  if (buffer.length > MAX_BUFFER) buffer.shift();
  for (const fn of listeners) fn(event);
  schedule();
};

/** One model call (one attempt), billed to the current call context. */
export const recordTokens = (call: { model: string; purpose: string; usage: TokenUsage; estimated: boolean; ok: boolean; ms: number }): void => {
  const ctx = callContext();
  push({
    at: Date.now(),
    userId: ctx.userId ?? null,
    projectId: ctx.projectId ?? null,
    purpose: call.purpose,
    kind: "llm",
    model: call.model,
    ...call.usage,
    ttsChars: 0,
    costUsd: tokenCost(call.model, call.usage),
    estimated: call.estimated,
    ok: call.ok,
    ms: call.ms,
  });
};

/** One speech synthesis request. */
export const recordSpeech = (call: { model: string; purpose: string; chars: number; ok: boolean; ms: number; projectId?: string }): void => {
  const ctx = callContext();
  push({
    at: Date.now(),
    userId: ctx.userId ?? null,
    projectId: call.projectId ?? ctx.projectId ?? null,
    purpose: call.purpose,
    kind: "tts",
    model: call.model,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    ttsChars: call.chars,
    costUsd: charCost(call.model, call.chars),
    estimated: false,
    ok: call.ok,
    ms: call.ms,
  });
};

/** A video started (counts against the plan's videos per month). */
export const recordVideo = (projectId: string, userId: string): void => {
  push({
    at: Date.now(),
    userId,
    projectId,
    purpose: "video",
    kind: "video",
    model: "",
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    ttsChars: 0,
    costUsd: null,
    estimated: false,
    ok: true,
    ms: 0,
  });
};

/** Events recorded but not yet written (quota checks add them to the database totals). */
export const unflushed = (): readonly UsageEvent[] => buffer;

export const eventTokens = (e: UsageEvent): number => totalTokens(e);
