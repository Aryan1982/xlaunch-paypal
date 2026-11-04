import { forgetAccount } from "../auth";
import { db, must } from "../db";
import { recordFunnel } from "../usage/funnel";
import { FOUNDER_SKU } from "./catalog";
import type { BillingStore, Outcome } from "./events";

/** The books, in the database: what every payment provider's events are applied to. */

/** For like/ilike: `_` and `%` are wildcards, and a_b@x.com must not match axb@x.com. */
const literal = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export const dbStore: BillingStore = {
  userExists: async (userId) =>
    !!must(await db().from("user_plans").select("user_id").eq("user_id", userId).maybeSingle(), "find user"),
  userIdByEmail: async (email) => {
    const row = must(await db().from("user_plans").select("user_id").ilike("email", literal(email)).maybeSingle(), "find user by email") as {
      user_id: string;
    } | null;
    return row?.user_id ?? null;
  },
  subscription: async (subscriptionId) => {
    const row = must(
      await db().from("subscriptions").select("user_id, sku").eq("dodo_subscription_id", subscriptionId).maybeSingle(),
      "find subscription"
    ) as { user_id: string; sku: string } | null;
    return row ? { userId: row.user_id, sku: row.sku } : null;
  },
  upsertSubscription: async (row) => {
    must(
      await db().from("subscriptions").upsert({
        dodo_subscription_id: row.subscriptionId,
        user_id: row.userId,
        sku: row.sku,
        status: row.status,
        next_billing_date: row.nextBillingDate,
        ...(row.customerId ? { dodo_customer_id: row.customerId } : {}),
        updated_at: new Date().toISOString(),
      }),
      "record subscription"
    );
  },
  isFounder: async (userId) =>
    !!must(
      await db().from("credit_ledger").select("id").eq("user_id", userId).eq("kind", "grant").like("reason", `%${literal(FOUNDER_SKU)}%`).limit(1).maybeSingle(),
      "founder check"
    ),
  grant: async (g) => {
    // Only for the log and the outcome: credit_grant itself never grants a ref twice, even if two deliveries race past this.
    if (must(await db().from("credit_ledger").select("id").eq("ref", g.ref).maybeSingle(), "granted already")) return false;
    must(
      await db().rpc("credit_grant", {
        p_user: g.userId,
        p_sub: g.sub,
        p_pack: g.pack,
        p_sub_cap: g.subCap,
        p_ref: g.ref,
        p_reason: g.reason,
        p_dodo_ref: g.dodoRef,
      }),
      "grant credits"
    );
    return true;
  },
  revoke: async (grantRef, reason) => must(await db().rpc("credit_revoke", { p_grant_ref: grantRef, p_reason: reason }), "revoke credits") as boolean,
  entitle: async (userId, e) => {
    must(await db().rpc("entitle_user", { p_user: userId, p_plan: e.plan, p_storage_mb: e.storageMb }), "entitle user");
    forgetAccount(userId);
  },
};

/** The funnel's "paid" step, the one time a payment adds credits (webhook, status check or catch-up, whichever is first). */
export const notePaid = (who: { userId?: unknown; projectId?: unknown }, outcome: Outcome): void => {
  if (!outcome.applied) return;
  void recordFunnel("paid", {
    userId: typeof who.userId === "string" ? who.userId : null,
    projectId: typeof who.projectId === "string" && who.projectId ? who.projectId : null,
  });
};

/** Dodo's payments name the buyer in their checkout metadata. */
export const dodoBuyer = (data: unknown): { userId?: unknown; projectId?: unknown } => {
  const meta = data && typeof data === "object" && "metadata" in data ? data.metadata : undefined;
  if (!meta || typeof meta !== "object") return {};
  return { userId: "user_id" in meta ? meta.user_id : undefined, projectId: "project_id" in meta ? meta.project_id : undefined };
};
