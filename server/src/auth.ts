import type express from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";

import { isApiKey, ownerOfKey } from "./apikeys";
import { db, dbEnabled, must, supabaseUrl } from "./db";
import { HttpError } from "./lib/http";

/**
 * Who is calling. The web app's proxy (client/proxy.ts) forwards the user's
 * Supabase access token as `Authorization: Bearer`; it is verified here
 * against the project's signing keys (JWKS, ES256), with no round trip to
 * Supabase per request.
 */

export type Account = {
  id: string;
  email: string;
  plan: string;
  isAdmin: boolean;
  videosPerMonth: number;
  tokensPerMonth: number;
  storageMb: number;
  /** May make any number of free previews (set from Accessboard; db/010). */
  unlimitedPreviews?: boolean;
  /** Set when the caller is a program (an API key or an OAuth-connected app such as a Claude connector), not the web app's session. */
  viaKey?: boolean;
};

/** Local development without a database: one implicit admin. */
const LOCAL: Account = {
  id: "local",
  email: "local@localhost",
  plan: "local",
  isAdmin: true,
  videosPerMonth: Number.MAX_SAFE_INTEGER,
  tokensPerMonth: Number.MAX_SAFE_INTEGER,
  storageMb: Number.MAX_SAFE_INTEGER,
};

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

/** Who a Supabase access token belongs to; `clientId` is set when Supabase's OAuth server issued it to a connected app. */
export type TokenClaims = { sub: string; email: string; clientId: string | null };

/** Verifies a Supabase access token: the web app's session, or a connected app's OAuth token. */
export const verifyToken = async (token: string): Promise<TokenClaims> => {
  jwks ??= createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`));
  const { payload } = await jwtVerify(token, jwks, { issuer: `${supabaseUrl}/auth/v1`, audience: "authenticated" });
  if (typeof payload.sub !== "string") throw new Error("token has no subject");
  return { sub: payload.sub, email: typeof payload.email === "string" ? payload.email : "", clientId: typeof payload.client_id === "string" ? payload.client_id : null };
};

type PlanRow = {
  user_id: string;
  email: string;
  plan: string;
  is_admin: boolean;
  videos_per_month: number;
  tokens_per_month: number;
  storage_mb: number;
  unlimited_previews?: boolean | null;
};

const toAccount = (r: PlanRow): Account => ({
  id: r.user_id,
  email: r.email,
  plan: r.plan,
  isAdmin: r.is_admin,
  videosPerMonth: r.videos_per_month,
  tokensPerMonth: Number(r.tokens_per_month),
  storageMb: r.storage_mb,
  unlimitedPreviews: r.unlimited_previews === true,
});

// Plan rows change rarely (approvals, limits); a short cache keeps requests fast.
const accounts = new Map<string, { at: number; account: Account }>();
const ACCOUNT_TTL_MS = 30_000;

export const loadAccount = async (userId: string, email = ""): Promise<Account> => {
  const hit = accounts.get(userId);
  if (hit && Date.now() - hit.at < ACCOUNT_TTL_MS) return hit.account;
  let row = must(await db().from("user_plans").select("*").eq("user_id", userId).maybeSingle(), "load plan") as PlanRow | null;
  if (!row) {
    // The sign-up trigger normally creates it; never leave a user without one.
    must(await db().from("user_plans").upsert({ user_id: userId, email }, { onConflict: "user_id", ignoreDuplicates: true }), "create plan");
    row = must(await db().from("user_plans").select("*").eq("user_id", userId).single(), "load plan") as PlanRow;
  }
  const account = toAccount(row);
  accounts.set(userId, { at: Date.now(), account });
  return account;
};

export const forgetAccount = (userId: string): void => {
  accounts.delete(userId);
};

const bearer = (req: express.Request): string | null => {
  const header = req.headers.authorization ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(header);
  return m ? m[1].trim() : null;
};

/**
 * The signed-in account, or a 401. The bearer is a Supabase access token (the web app's session,
 * or an OAuth-connected app's) or an API key (`xl_...`, programs and MCP clients). Keys and
 * connected apps act as their owner but can't manage API keys.
 */
export const authenticate = async (req: express.Request): Promise<Account> => {
  if (!dbEnabled()) return LOCAL;
  const token = bearer(req);
  if (!token) throw new HttpError(401, "Please sign in.", { code: "signin" });
  if (isApiKey(token)) {
    const userId = await ownerOfKey(token);
    if (!userId) throw new HttpError(401, "That API key isn't valid or has been revoked.", { code: "signin" });
    return { ...(await loadAccount(userId)), viaKey: true };
  }
  let claims: TokenClaims;
  try {
    claims = await verifyToken(token);
  } catch {
    throw new HttpError(401, "Your session has expired. Please sign in again.", { code: "signin" });
  }
  const account = await loadAccount(claims.sub, claims.email);
  return claims.clientId ? { ...account, viaKey: true } : account;
};

/** Express glue: the account set by the auth middleware. */
export const accountOf = (res: express.Response): Account => {
  const account = res.locals.account as Account | undefined;
  if (!account) throw new HttpError(401, "Please sign in.", { code: "signin" });
  return account;
};
