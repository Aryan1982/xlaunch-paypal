import { createHash, randomBytes } from "crypto";

import { db, must } from "./db";
import { HttpError } from "./lib/http";

/**
 * API keys: `xl_` + 40 url-safe characters. Only a SHA-256 hash is stored
 * (db/003_api_keys.sql); the key is shown once, when it is made. A key acts
 * as its owner on every API route except key management, which needs the
 * signed-in session (a leaked key can't mint more keys).
 */

export const KEY_PATTERN = /^xl_[A-Za-z0-9_-]{40}$/;
export const MAX_ACTIVE_KEYS = 10;

export const newApiKey = (): string => `xl_${randomBytes(30).toString("base64url")}`;
export const hashKey = (key: string): string => createHash("sha256").update(key, "utf8").digest("hex");
export const isApiKey = (token: string): boolean => KEY_PATTERN.test(token);
/** What a user sees to tell keys apart: `xl_AbCd123…`. */
export const keyPrefix = (key: string): string => key.slice(0, 10);

export type ApiKeyInfo = { id: string; name: string; prefix: string; createdAt: string; lastUsedAt: string | null };

type Row = { id: string; user_id: string; name: string; prefix: string; created_at: string; last_used_at: string | null };
const toInfo = (r: Row): ApiKeyInfo => ({ id: r.id, name: r.name, prefix: r.prefix, createdAt: r.created_at, lastUsedAt: r.last_used_at });

export const listKeys = async (userId: string): Promise<ApiKeyInfo[]> =>
  (must(
    await db().from("api_keys").select("id, user_id, name, prefix, created_at, last_used_at").eq("user_id", userId).is("revoked_at", null).order("created_at", { ascending: false }),
    "list keys"
  ) as Row[]).map(toInfo);

/** Make a key; the returned `key` is the only time it is ever available. */
export const createKey = async (userId: string, name: string): Promise<ApiKeyInfo & { key: string }> => {
  if ((await listKeys(userId)).length >= MAX_ACTIVE_KEYS) {
    throw new HttpError(409, `You have ${MAX_ACTIVE_KEYS} keys already. Revoke one you no longer use first.`);
  }
  const key = newApiKey();
  const row = must(
    await db().from("api_keys").insert({ user_id: userId, name, prefix: keyPrefix(key), key_hash: hashKey(key) }).select("id, user_id, name, prefix, created_at, last_used_at").single(),
    "create key"
  ) as Row;
  return { ...toInfo(row), key };
};

export const revokeKey = async (userId: string, id: string): Promise<void> => {
  const rows = must(
    await db().from("api_keys").update({ revoked_at: new Date().toISOString() }).eq("id", id).eq("user_id", userId).is("revoked_at", null).select("key_hash"),
    "revoke key"
  ) as Array<{ key_hash: string }>;
  if (rows.length === 0) throw new HttpError(404, "No such key.");
  for (const r of rows) owners.delete(r.key_hash);
};

// A key is looked up on every request it makes; a short cache keeps that cheap.
// Revoking in this process drops the entry at once (revokeKey above).
const owners = new Map<string, { at: number; userId: string | null }>();
const OWNER_TTL_MS = 30_000;
const touched = new Map<string, number>();
const TOUCH_EVERY_MS = 5 * 60_000;

/** The user a key belongs to, or null for an unknown or revoked key. */
export const ownerOfKey = async (key: string): Promise<string | null> => {
  const hash = hashKey(key);
  const hit = owners.get(hash);
  if (hit && Date.now() - hit.at < OWNER_TTL_MS) return hit.userId;
  const row = must(await db().from("api_keys").select("user_id").eq("key_hash", hash).is("revoked_at", null).maybeSingle(), "find key") as {
    user_id: string;
  } | null;
  const userId = row?.user_id ?? null;
  owners.set(hash, { at: Date.now(), userId });
  if (userId && Date.now() - (touched.get(hash) ?? 0) > TOUCH_EVERY_MS) {
    touched.set(hash, Date.now());
    void db().from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("key_hash", hash).then(() => undefined, () => undefined);
  }
  return userId;
};
