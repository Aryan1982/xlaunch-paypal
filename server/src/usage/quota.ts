import type { Account } from "../auth";
import { billingEnabled } from "../billing/credits";
import { db, dbEnabled, must } from "../db";
import { HttpError } from "../lib/http";
import { setPrices, type ModelPrice } from "./prices";
import { eventTokens, flushUsage, setUsageSink, unflushed, type UsageEvent } from "./ledger";
import { storageEnabled, userStoredBytes } from "../storage";

/**
 * Plans and quotas. Each plan row (user_plans) sets videos and tokens per
 * calendar month (UTC) and stored megabytes; usage comes from the ledger.
 * Checked before any work that spends money; admins are never limited.
 */

const toRow = (e: UsageEvent) => ({
  at: new Date(e.at).toISOString(),
  user_id: e.userId && e.userId !== "local" ? e.userId : null,
  project_id: e.projectId,
  kind: e.kind,
  purpose: e.purpose.slice(0, 120),
  model: e.model,
  input_tokens: e.inputTokens,
  output_tokens: e.outputTokens,
  cache_read_tokens: e.cacheReadTokens,
  cache_write_tokens: e.cacheWriteTokens,
  tts_chars: e.ttsChars,
  cost_usd: e.costUsd,
  estimated: e.estimated,
  ok: e.ok,
  ms: Math.round(e.ms),
});

const loadPrices = async (): Promise<void> => {
  const rows = must(await db().from("model_prices").select("*"), "load prices") as Array<{
    model: string;
    input: number;
    output: number;
    cache_read: number | null;
    cache_write: number | null;
    per_k_chars: number | null;
  }>;
  const prices: Record<string, ModelPrice> = {};
  for (const r of rows) {
    prices[r.model] = {
      input: Number(r.input),
      output: Number(r.output),
      ...(r.cache_read != null ? { cacheRead: Number(r.cache_read) } : {}),
      ...(r.cache_write != null ? { cacheWrite: Number(r.cache_write) } : {}),
      ...(r.per_k_chars != null ? { perKChars: Number(r.per_k_chars) } : {}),
    };
  }
  setPrices(prices);
};

/** At boot: ledger to the database, prices from it (refreshed every 5 minutes). */
export const initUsage = async (): Promise<void> => {
  if (!dbEnabled()) return;
  setUsageSink(async (events) => {
    must(await db().from("usage_events").insert(events.map(toRow)), "write usage");
  });
  await loadPrices().catch((error) => console.error("[usage] could not load prices:", error));
  setInterval(() => void loadPrices().catch(() => undefined), 5 * 60_000).unref();
};

export type MonthUsage = { videos: number; tokens: number; costUsd: number; storedBytes: number };

export const monthUsage = async (userId: string): Promise<MonthUsage> => {
  if (!dbEnabled()) return { videos: 0, tokens: 0, costUsd: 0, storedBytes: 0 };
  // the month's totals and the stored bytes are separate lookups: ask both at once
  const [usage, storedBytes] = await Promise.all([
    db().from("usage_this_month").select("*").eq("user_id", userId).maybeSingle(),
    storageEnabled() ? userStoredBytes(userId) : Promise.resolve(0),
  ]);
  const row = must(usage, "load usage") as {
    tokens: number;
    videos: number;
    cost_usd: number;
  } | null;
  const pending = unflushed().filter((e) => e.userId === userId);
  return {
    videos: Number(row?.videos ?? 0) + pending.filter((e) => e.kind === "video").length,
    tokens: Number(row?.tokens ?? 0) + pending.reduce((sum, e) => sum + eventTokens(e), 0),
    costUsd: Number(row?.cost_usd ?? 0) + pending.reduce((sum, e) => sum + (e.costUsd ?? 0), 0),
    storedBytes,
  };
};

const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));

/**
 * Throw 402 when the account is out of quota. `video` is a new video (also
 * needs token and storage room); `tokens` is any other paid step (chat edits,
 * regenerations, story rewrites).
 */
export const assertQuota = async (account: Account, kind: "video" | "tokens"): Promise<void> => {
  if (!dbEnabled() || account.isAdmin) return;
  // With billing on, credits are what limit paid work (billing/credits.ts); only storage still has a cap here.
  if (billingEnabled()) {
    if (kind === "video" && account.storageMb > 0 && (await monthUsage(account.id)).storedBytes >= account.storageMb * 1024 * 1024) {
      throw new HttpError(402, "Your storage is full. Delete an old project to make room.", { code: "quota", quota: "storage" });
    }
    return;
  }
  const used = await monthUsage(account.id);
  if (kind === "video" && used.videos >= account.videosPerMonth) {
    throw new HttpError(402, `You've made ${account.videosPerMonth} videos this month, the limit for your plan. It resets on the 1st.`, {
      code: "quota",
      quota: "videos",
    });
  }
  if (used.tokens >= account.tokensPerMonth) {
    throw new HttpError(402, `You've used this month's generation budget (${fmt(account.tokensPerMonth)} tokens). It resets on the 1st.`, {
      code: "quota",
      quota: "tokens",
    });
  }
  if (kind === "video" && used.storedBytes >= account.storageMb * 1024 * 1024) {
    throw new HttpError(402, "Your storage is full. Delete an old project to make room.", { code: "quota", quota: "storage" });
  }
};

export { flushUsage };
