import type { Account } from "../auth";
import { db, dbEnabled } from "../db";

/**
 * Free previews: a new user who can't pay for a video yet gets one free
 * preview instead of a "get credits" wall (the whole film planned and its
 * opening built; db/009). One per account for good, so deleting the project
 * doesn't hand out another, a few per IP a day against throwaway sign-ups, and
 * at most freePreviewsPerDay() a UTC day across everyone (they spend API credit).
 */

export const PREVIEWS_PER_IP_PER_DAY = 3;
const DAY_MS = 86_400_000;

/** Free previews a UTC day across all users (FREE_PREVIEWS_PER_DAY, default 5); accounts with unlimited previews don't count. */
export const freePreviewsPerDay = (): number => {
  const n = Number(process.env.FREE_PREVIEWS_PER_DAY);
  return Number.isFinite(n) && n >= 0 && process.env.FREE_PREVIEWS_PER_DAY?.trim() ? Math.floor(n) : 5;
};

/** How a claim went: the preview is the account's now, it had one already (or its IP is out), or today's are all taken. */
export type PreviewClaim = "claimed" | "refused" | "full";

// without a database (local runs): the same rules in memory
const memory = new Map<string, { projectId: string; ip: string; at: number; unlimited: boolean }>();

const startOfUtcDay = (now: number): number => now - (now % DAY_MS);

const recentFromIp = async (ip: string): Promise<number> => {
  const since = Date.now() - DAY_MS;
  if (!dbEnabled()) return [...memory.values()].filter((p) => p.ip === ip && p.at > since).length;
  const { count, error } = await db()
    .from("free_previews")
    .select("user_id", { count: "exact", head: true })
    .eq("ip", ip)
    .gte("created_at", new Date(since).toISOString());
  if (error) throw new Error(error.message);
  return count ?? 0;
};

/**
 * Today's counted previews (since 00:00 UTC), oldest first, ties by user id:
 * every account's but those allowed unlimited previews (user_plans.unlimited_previews).
 */
const todaysPreviews = async (): Promise<string[]> => {
  const since = startOfUtcDay(Date.now());
  if (!dbEnabled()) {
    return [...memory.entries()]
      .filter(([, p]) => !p.unlimited && p.at >= since)
      .sort(([a, p], [b, q]) => p.at - q.at || a.localeCompare(b))
      .map(([id]) => id);
  }
  const unlimited = await db().from("user_plans").select("user_id").eq("unlimited_previews", true);
  if (unlimited.error) throw new Error(unlimited.error.message);
  const skip = ((unlimited.data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id);
  let query = db().from("free_previews").select("user_id").gte("created_at", new Date(since).toISOString());
  if (skip.length) query = query.not("user_id", "in", `(${skip.join(",")})`);
  const { data, error } = await query.order("created_at", { ascending: true }).order("user_id", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id);
};

/** Free previews still to be had today (0 once the day's are taken). */
export const freePreviewsLeft = async (): Promise<number> => {
  try {
    return Math.max(0, freePreviewsPerDay() - (await todaysPreviews()).length);
  } catch (error) {
    console.warn("[preview] count failed:", error instanceof Error ? error.message : error);
    return 0;
  }
};

/**
 * Claim the account's free preview for `projectId`. The claim is the insert,
 * so two requests at once can't both have it; the day's cap is checked before
 * the insert and again after it (only the day's first freePreviewsPerDay()
 * keep theirs; a later one is taken back), so a race can't go over it.
 * Fails closed: an error is no preview.
 */
export const claimPreview = async (account: Account, projectId: string, ip: string): Promise<PreviewClaim> => {
  let inserted = false;
  try {
    // allowed any number (the team, testers): no per-account, per-IP or daily limit; the record points at the latest
    if (account.unlimitedPreviews) {
      if (!dbEnabled()) {
        memory.set(account.id, { projectId, ip, at: Date.now(), unlimited: true });
        return "claimed";
      }
      const { error } = await db()
        .from("free_previews")
        .upsert({ user_id: account.id, project_id: projectId, ip, created_at: new Date().toISOString(), emailed_at: null }, { onConflict: "user_id" });
      if (error) throw new Error(error.message);
      return "claimed";
    }
    if (await previewOf(account)) return "refused";
    if ((await recentFromIp(ip)) >= PREVIEWS_PER_IP_PER_DAY) return "refused";
    const cap = freePreviewsPerDay();
    if ((await todaysPreviews()).length >= cap) return "full";
    if (!dbEnabled()) {
      if (memory.has(account.id)) return "refused";
      memory.set(account.id, { projectId, ip, at: Date.now(), unlimited: false });
    } else {
      const { error } = await db().from("free_previews").insert({ user_id: account.id, project_id: projectId, ip });
      // a duplicate key: the account had its preview already
      if (error) return "refused";
    }
    inserted = true;
    if (!(await todaysPreviews()).slice(0, cap).includes(account.id)) {
      await release(account);
      return "full";
    }
    return "claimed";
  } catch (error) {
    console.warn("[preview] claim failed, no preview:", error instanceof Error ? error.message : error);
    // the row went in but couldn't be checked: take it back, so the account isn't left with a preview it never got
    if (inserted) await release(account).catch(() => undefined);
    return "refused";
  }
};

/** Take back an account's just-made claim. */
const release = async (account: Account): Promise<void> => {
  if (!dbEnabled()) {
    memory.delete(account.id);
    return;
  }
  const { error } = await db().from("free_previews").delete().eq("user_id", account.id);
  if (error) throw new Error(error.message);
};

/** The project of the account's free preview, if it has had one (and the project still exists to go back to). */
export const previewOf = async (account: Account): Promise<string | null> => {
  try {
    if (!dbEnabled()) return memory.get(account.id)?.projectId ?? null;
    const { data, error } = await db().from("free_previews").select("project_id").eq("user_id", account.id).maybeSingle();
    if (error) return null;
    return (data as { project_id?: string } | null)?.project_id ?? null;
  } catch {
    return null;
  }
};

/**
 * The client's address. A web app on another host (the hackathon client on
 * Vercel) reaches the API through nginx from its own address, so it sends the
 * visitor's as X-XLaunch-Client-IP, trusted only beside the shared
 * PROXY_SECRET. Else nginx's X-Real-IP (it overwrites whatever the client
 * sent), else the socket's.
 */
export const clientIp = (headers: Record<string, string | string[] | undefined>, socketIp: string | undefined): string => {
  const secret = process.env.PROXY_SECRET;
  const forwarded = headers["x-xlaunch-client-ip"];
  if (secret && headers["x-xlaunch-proxy-secret"] === secret && typeof forwarded === "string" && forwarded.trim()) return forwarded.trim();
  const real = headers["x-real-ip"];
  return (typeof real === "string" && real.trim()) || socketIp || "unknown";
};
