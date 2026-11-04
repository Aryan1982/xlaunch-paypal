import DodoPayments from "dodopayments";

import type { Account } from "../auth";
import { config } from "../config";
import { db, dbEnabled, must } from "../db";
import { HttpError } from "../lib/http";
import { productBySku, productIdFor, skuForProductId } from "./catalog";
import { dbStore, dodoBuyer, notePaid } from "./books";
import { balanceOf, billingEnabled } from "./credits";
import { applyEvent, BadSignature, RetryLater, type Outcome } from "./events";

/**
 * Dodo Payments: hosted checkout, the customer portal, and webhooks.
 *
 * DODO_ENVIRONMENT picks test_mode or live_mode (default test_mode, so a
 * forgotten variable can never take real money from a development machine).
 * The API key, webhook key and DODO_PRODUCTS all belong to that one mode.
 */

export type DodoEnvironment = "test_mode" | "live_mode";

export const dodoEnvironment = (): DodoEnvironment => (process.env.DODO_ENVIRONMENT === "live_mode" ? "live_mode" : "test_mode");

let client: DodoPayments | null = null;
const dodo = (): DodoPayments =>
  (client ??= new DodoPayments({
    bearerToken: process.env.DODO_PAYMENTS_API_KEY ?? "",
    webhookKey: process.env.DODO_PAYMENTS_WEBHOOK_KEY ?? null,
    environment: dodoEnvironment(),
  }));

const requireBilling = (): void => {
  if (!billingEnabled()) throw new HttpError(503, "Payments aren't switched on yet.");
};

// ---------------------------------------------------------------------------
// Checkout and portal
// ---------------------------------------------------------------------------

const activeSubscription = async (userId: string): Promise<{ sku: string; customerId: string | null } | null> => {
  const row = must(
    await db()
      .from("subscriptions")
      .select("sku, dodo_customer_id")
      .eq("user_id", userId)
      .in("status", ["active", "on_hold", "past_due"])
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    "active subscription"
  ) as { sku: string; dodo_customer_id: string | null } | null;
  return row ? { sku: row.sku, customerId: row.dodo_customer_id } : null;
};

/**
 * The name the account signed up with (Google sign-in gives one), or none.
 * Dodo locks a name given here for the session, so a guess (the email's
 * local part) is worse than leaving it for the buyer to type.
 */
const fullNameOf = async (userId: string): Promise<string | undefined> => {
  if (!dbEnabled()) return undefined;
  try {
    const { data } = await db().auth.admin.getUserById(userId);
    const meta = (data.user?.user_metadata ?? {}) as Record<string, unknown>;
    const name = [meta.full_name, meta.name].find((v): v is string => typeof v === "string" && v.trim() !== "");
    return name?.trim();
  } catch {
    return undefined;
  }
};

/**
 * A hosted checkout for one product; returns the URL to send the browser to.
 * `projectId`: a free preview waiting for this purchase, which the browser goes back to (and finishes) after paying.
 */
export const createCheckout = async (account: Account, sku: string, projectId?: string): Promise<string> => {
  requireBilling();
  const product = productBySku(sku);
  const productId = productIdFor(sku);
  if (!product || !productId) throw new HttpError(400, "That plan isn't available.");
  if (product.kind === "subscription" && (await activeSubscription(account.id))) {
    throw new HttpError(409, "You already have a plan. Change or cancel it from Manage billing.", { code: "has_plan" });
  }
  // back to the preview waiting for it, else the Credits page
  const back = projectId ? `/p/${projectId}` : "/billing";
  const name = await fullNameOf(account.id);
  const session = await dodo().checkoutSessions.create({
    product_cart: [{ product_id: productId, quantity: 1 }],
    customer: { email: account.email, ...(name ? { name } : {}) },
    // no coupon box: an empty one sends people off to look for a code (set it back to true to hand out codes)
    feature_flags: { allow_discount_code: false },
    // read back on the payment and subscription webhooks to know whose purchase it is
    metadata: { user_id: account.id, sku, ...(projectId ? { project_id: projectId } : {}) },
    // Dodo adds payment_id or subscription_id and a status; the page asks us for the real outcome (checkoutStatus)
    return_url: `${config.appOrigin}${back}?checkout=done&sku=${encodeURIComponent(sku)}`,
    // a back button on Dodo's page: nothing was charged
    cancel_url: `${config.appOrigin}${back}?checkout=cancelled&sku=${encodeURIComponent(sku)}`,
  });
  if (!session.checkout_url) throw new HttpError(502, "Checkout didn't start. Try again.");
  return session.checkout_url;
};

/** Dodo's own page for changing plan, cancelling and invoices. */
export const createPortal = async (account: Account): Promise<string> => {
  requireBilling();
  const sub = await activeSubscription(account.id);
  if (!sub?.customerId) throw new HttpError(404, "There's no plan to manage yet.");
  const session = await dodo().customers.customerPortal.create(sub.customerId, { return_url: `${config.appOrigin}/billing` });
  return session.link;
};

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

/**
 * Verify and apply one delivery. Throws BadSignature (answer 401) or
 * RetryLater / any other error (answer 5xx, Dodo delivers again). A delivery
 * already applied is skipped; every credit change is idempotent besides.
 */
export const handleWebhook = async (rawBody: string, headers: Record<string, string>): Promise<Outcome> => {
  requireBilling();
  let event: { type: string; data: unknown };
  try {
    event = dodo().webhooks.unwrap(rawBody, { headers }) as unknown as { type: string; data: unknown };
  } catch {
    throw new BadSignature("Webhook signature did not verify.");
  }
  const webhookId = headers["webhook-id"] ?? "";
  if (webhookId && must(await db().from("billing_events").select("webhook_id").eq("webhook_id", webhookId).maybeSingle(), "seen webhook")) {
    return { applied: false, note: `${webhookId}: already applied` };
  }
  const outcome = await applyEvent(dbStore, event);
  if (event.type === "payment.succeeded") notePaid(dodoBuyer(event.data), outcome);
  // recorded only once applied, so a delivery that failed part-way runs again on retry
  if (webhookId) {
    must(
      await db().from("billing_events").upsert({ webhook_id: webhookId, type: event.type, payload: JSON.parse(rawBody) }),
      "record webhook"
    );
  }
  return outcome;
};

export { RetryLater };

// ---------------------------------------------------------------------------
// Back from checkout
// ---------------------------------------------------------------------------

/** What a checkout came to: paid (and whether its credits are in), still going, or failed. */
export type CheckoutStatus = {
  state: "paid" | "pending" | "failed";
  /** The credits of a paid checkout are on the balance. */
  credited: boolean;
  sku: string | null;
  balance: number;
};

const FAILED_PAYMENT = new Set(["failed", "cancelled"]);
const FAILED_SUBSCRIPTION = new Set(["failed", "cancelled", "expired"]);

/**
 * The real outcome of the caller's checkout, asked of Dodo by the id it put
 * on the return URL (whose `status` the browser could change, so it isn't
 * read). Only the caller's own checkout answers (its metadata names them).
 * A paid one is applied here if the webhook hasn't yet (once per payment,
 * so racing the webhook adds nothing twice).
 */
export const checkoutStatus = async (account: Account, ids: { paymentId?: string; subscriptionId?: string }): Promise<CheckoutStatus> => {
  requireBilling();
  const notFound = () => new HttpError(404, "That checkout isn't on this account.");
  let paymentId = ids.paymentId;
  let subscriptionFailed = false;
  let sku: string | null = null;
  // a subscription id is always checked to be the caller's, whatever else is given
  if (ids.subscriptionId) {
    const sub = await dodo().subscriptions.retrieve(ids.subscriptionId).catch(() => null);
    if (!sub || String(sub.metadata?.user_id ?? "") !== account.id) throw notFound();
    sku = skuForProductId(sub.product_id) ?? null;
    subscriptionFailed = FAILED_SUBSCRIPTION.has(sub.status);
    // our record of the subscription, which its renewals need
    if (sub.status === "active") await applyEvent(dbStore, { type: "subscription.active", data: sub });
    // its first payment says whether the money went through
    if (!paymentId) {
      const page = await dodo().payments.list({ subscription_id: sub.subscription_id, page_size: 10 });
      const latest = [...page.items].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
      paymentId = latest?.payment_id;
    }
    if (!paymentId) return { state: subscriptionFailed ? "failed" : "pending", credited: false, sku, balance: (await balanceOf(account.id)).total };
  }
  if (!paymentId) throw new HttpError(400, "No checkout to look up.");
  const payment = await dodo().payments.retrieve(paymentId).catch(() => null);
  // a subscription's payment is the caller's when the subscription was (checked above)
  if (!payment || (!ids.subscriptionId && String(payment.metadata?.user_id ?? "") !== account.id)) throw notFound();
  if (ids.subscriptionId && payment.subscription_id !== ids.subscriptionId) throw notFound();
  const metaSku = payment.metadata?.sku;
  sku ??= typeof metaSku === "string" ? metaSku : null;
  let credited = false;
  let state: CheckoutStatus["state"] = "pending";
  if (payment.status === "succeeded") {
    state = "paid";
    const outcome = await applyEvent(dbStore, { type: "payment.succeeded", data: payment });
    notePaid(dodoBuyer(payment), outcome);
    credited = outcome.applied || /already granted/.test(outcome.note);
  } else if (FAILED_PAYMENT.has(payment.status ?? "") || subscriptionFailed) {
    state = "failed";
  }
  return { state, credited, sku, balance: (await balanceOf(account.id)).total };
};

// ---------------------------------------------------------------------------
// Catching up without the webhook
// ---------------------------------------------------------------------------

const lastSync = new Map<string, number>();
const SYNC_EVERY_MS = 10_000;
const SYNC_DAYS = 7;

/**
 * Apply the caller's recent paid checkouts that no webhook has applied yet
 * (a delivery that failed, or hasn't arrived). Asks Dodo directly, so credits
 * arrive even when the webhook never does. Only payments whose checkout
 * metadata names this account count; grants are once per payment, so racing
 * the webhook adds nothing twice. Returns how many payments added credits.
 */
export const syncPurchases = async (account: Account): Promise<number> => {
  if (!billingEnabled()) return 0;
  const now = Date.now();
  if (now - (lastSync.get(account.id) ?? 0) < SYNC_EVERY_MS) return 0;
  lastSync.set(account.id, now);

  const since = new Date(now - SYNC_DAYS * 86_400_000).toISOString();
  const page = await dodo().payments.list({ status: "succeeded", created_at_gte: since, page_size: 50 });
  let added = 0;
  for (const listed of page.items) {
    if (listed.metadata?.user_id !== account.id) continue;
    // the list leaves out the cart, which says what was bought
    const payment = await dodo().payments.retrieve(listed.payment_id);
    if (payment.subscription_id) {
      // our record of the subscription, which renewals need (the webhook keeps it current after this)
      const sub = await dodo().subscriptions.retrieve(payment.subscription_id);
      await applyEvent(dbStore, { type: "subscription.active", data: sub });
    }
    const outcome = await applyEvent(dbStore, { type: "payment.succeeded", data: payment });
    notePaid(dodoBuyer(payment), outcome);
    if (outcome.applied) {
      added++;
      console.log(`[billing] caught up without the webhook: ${outcome.note}`);
    }
  }
  return added;
};
