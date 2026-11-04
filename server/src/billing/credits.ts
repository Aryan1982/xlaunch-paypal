import { randomBytes } from "crypto";

import type { Account } from "../auth";
import { db, dbEnabled, must } from "../db";
import { HttpError } from "../lib/http";

/**
 * Credits at runtime: what the API routes call. All arithmetic happens in the
 * database functions (db/002_credits.sql), one locked transaction each.
 *
 * Billing is on when there is a database and a Dodo API key. Off, every
 * function here is a no-op and the monthly quotas in usage/quota.ts stay the
 * limit, so this code ships dark until the keys are set.
 */

export type PaymentProvider = "dodo" | "paypal";

/** Who takes payments: Dodo unless PAYMENT_PROVIDER=paypal (the hackathon server, PayPal sandbox). */
export const paymentProvider = (): PaymentProvider => (process.env.PAYMENT_PROVIDER === "paypal" ? "paypal" : "dodo");

export const billingEnabled = (): boolean =>
  dbEnabled() &&
  (paymentProvider() === "paypal" ? !!process.env.PAYPAL_CLIENT_ID && !!process.env.PAYPAL_CLIENT_SECRET : !!process.env.DODO_PAYMENTS_API_KEY);

/** Admins use the app free, unless BILLING_CHARGE_ADMINS=1 (for testing billing as yourself). */
export const charges = (account: Account): boolean => billingEnabled() && (!account.isAdmin || process.env.BILLING_CHARGE_ADMINS === "1");

/** A held charge: refunded by its ref if the work it paid for fails. */
export type Charge = { ref: string; credits: number };

export type Balance = { sub: number; pack: number; total: number };

export const newRef = (kind: string, projectId: string): string => `${kind}:${projectId}:${randomBytes(6).toString("base64url")}`;

/**
 * Take `credits` from the account, or throw 402 {code: "credits"}. Returns
 * null when nothing was charged (billing off, or an exempt admin).
 */
export const charge = async (account: Account, credits: number, reason: string, projectId: string | null, ref: string): Promise<Charge | null> => {
  if (!charges(account)) return null;
  const result = must(
    await db().rpc("credit_spend", { p_user: account.id, p_amount: credits, p_ref: ref, p_reason: reason, p_project: projectId }),
    "spend credits"
  ) as { ok: boolean; balance: number };
  if (!result.ok) {
    throw new HttpError(402, `This needs ${credits.toLocaleString("en-US")} credits and you have ${Math.max(0, result.balance).toLocaleString("en-US")}.`, {
      code: "credits",
      needed: credits,
      balance: result.balance,
    });
  }
  return { ref, credits };
};

/**
 * Hold `credits` (the most the work may cost), or, when the balance is short
 * of that but covers `least` (what the work typically costs), the whole
 * balance: a dearer model can start on a smaller balance, and what the work
 * is charged is capped at what was held. Below `least`, throws 402 like charge().
 */
export const chargeUpTo = async (account: Account, credits: number, least: number, reason: string, projectId: string | null, ref: string): Promise<Charge | null> => {
  try {
    return await charge(account, credits, reason, projectId, ref);
  } catch (error) {
    const balance = error instanceof HttpError && error.details.code === "credits" ? Math.floor(Number(error.details.balance ?? 0)) : -1;
    if (balance < Math.max(1, least)) {
      if (balance >= 0) {
        throw new HttpError(402, `This needs at least ${least.toLocaleString("en-US")} credits to start and you have ${Math.max(0, balance).toLocaleString("en-US")}.`, {
          code: "credits",
          needed: least,
          balance,
        });
      }
      throw error;
    }
    return charge(account, balance, reason, projectId, ref);
  }
};

/** Give a charge back (the work failed). Never throws: a missed refund is logged, not shown to the user. */
export const refund = async (held: Charge | null | undefined, reason: string): Promise<boolean> => {
  if (!held || !billingEnabled()) return false;
  try {
    return must(await db().rpc("credit_refund", { p_spend_ref: held.ref, p_reason: reason }), "refund credits") as boolean;
  } catch (error) {
    console.error(`[billing] refund of ${held.ref} failed:`, error);
    return false;
  }
};

/**
 * Give back part of a charge: the unused share of a hold, once the work's
 * metered cost is known. Returns the credits given back. Never throws.
 */
export const refundPart = async (held: Charge | null | undefined, credits: number, reason: string): Promise<number> => {
  if (!held || credits <= 0 || !billingEnabled()) return 0;
  try {
    return Number(must(await db().rpc("credit_refund_part", { p_spend_ref: held.ref, p_amount: Math.round(credits), p_reason: reason }), "refund part"));
  } catch (error) {
    console.error(`[billing] partial refund of ${held.ref} failed:`, error);
    return 0;
  }
};

/** Has this user ever bought anything (a plan payment or a pack)? */
export const hasPurchased = async (userId: string): Promise<boolean> =>
  !!must(await db().from("credit_ledger").select("id").eq("user_id", userId).eq("kind", "grant").limit(1).maybeSingle(), "purchase check");

export const balanceOf = async (userId: string): Promise<Balance> => {
  if (!billingEnabled()) return { sub: 0, pack: 0, total: 0 };
  const row = must(
    await db().from("credit_accounts").select("sub_credits, pack_credits").eq("user_id", userId).maybeSingle(),
    "credit balance"
  ) as { sub_credits: number; pack_credits: number } | null;
  const sub = Number(row?.sub_credits ?? 0);
  const pack = Number(row?.pack_credits ?? 0);
  return { sub, pack, total: sub + pack };
};
