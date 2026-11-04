import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";

import { config } from "../config";

/**
 * Signed asset URLs. The headless renderer and the sandboxed preview (another
 * origin, no session cookie) load a project's images and narration with a
 * token scoped to that project: `?exp=<unix s>&sig=<hmac>`.
 *
 * Expiry is bucketed (12 h buckets, valid for the next full bucket), so the
 * URL is stable for hours and the render bundle cache, which keys on the
 * generated source, keeps hitting.
 */

const BUCKET_MS = 12 * 60 * 60 * 1000;

let secret: Buffer | null = null;

/** ASSET_SIGNING_SECRET in production; a key kept in data/ for local dev. */
const getSecret = (): Buffer => {
  if (secret) return secret;
  const fromEnv = process.env.ASSET_SIGNING_SECRET;
  if (fromEnv) return (secret = Buffer.from(fromEnv, "utf8"));
  const file = path.join(config.dataDir, ".asset-secret");
  try {
    secret = Buffer.from(readFileSync(file, "utf8").trim(), "utf8");
  } catch {
    const fresh = randomBytes(32).toString("hex");
    mkdirSync(config.dataDir, { recursive: true });
    writeFileSync(file, fresh, { mode: 0o600 });
    secret = Buffer.from(fresh, "utf8");
  }
  return secret;
};

/** A token for one scope never verifies for another: an asset link cannot download the video. */
type Scope = "asset" | "download";

const mac = (scope: Scope, projectId: string, exp: number): string =>
  createHmac("sha256", getSecret()).update(`${scope}:${projectId}:${exp}`).digest("base64url").slice(0, 32);

const verify = (scope: Scope, projectId: string, exp: unknown, sig: unknown, now: number): boolean => {
  if (typeof exp !== "string" || typeof sig !== "string" || !/^\d{1,12}$/.test(exp)) return false;
  const expiry = Number(exp);
  if (expiry * 1000 <= now) return false;
  const want = Buffer.from(mac(scope, projectId, expiry));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
};

/** Query string (no leading "?") granting read access to one project's assets. */
export const assetToken = (projectId: string, now = Date.now()): string => {
  const exp = ((Math.floor(now / BUCKET_MS) + 2) * BUCKET_MS) / 1000;
  return `exp=${exp}&sig=${mac("asset", projectId, exp)}`;
};

export const verifyAssetToken = (projectId: string, exp: unknown, sig: unknown, now = Date.now()): boolean =>
  verify("asset", projectId, exp, sig, now);

export const DOWNLOAD_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Query string granting one download of a project's exported video, for links
 * handed to someone without a session (an MCP client, a shared link). Not
 * bucketed: each link expires exactly `ttlMs` after it was made.
 */
export const downloadToken = (projectId: string, now = Date.now(), ttlMs = DOWNLOAD_TTL_MS): { query: string; expiresAt: number } => {
  const exp = Math.floor((now + ttlMs) / 1000);
  return { query: `exp=${exp}&sig=${mac("download", projectId, exp)}`, expiresAt: exp * 1000 };
};

export const verifyDownloadToken = (projectId: string, exp: unknown, sig: unknown, now = Date.now()): boolean =>
  verify("download", projectId, exp, sig, now);
