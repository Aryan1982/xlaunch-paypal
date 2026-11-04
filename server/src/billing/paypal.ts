import { z } from "zod";

import type { Account } from "../auth";
import { config } from "../config";
import { db, must } from "../db";
import { HttpError } from "../lib/http";
import { dbStore, notePaid } from "./books";
import { productBySku, type Pack } from "./catalog";
import { balanceOf, billingEnabled } from "./credits";
import { BadSignature, grantPacks, grantRef, RetryLater, type BillingStore, type Outcome } from "./events";

/**
 * PayPal Checkout (Orders v2): credit packs only, one pack per order.
 *
 * An order carries its buyer in the purchase unit's `custom_id` (set here, by
 * the server, so it can be trusted when read back). Credits are granted once
 * per order (`grant:paypal:<order id>`), by whichever comes first: the buyer's
 * page asking for the outcome (checkoutStatus), or a webhook. Capturing is
 * idempotent too (PayPal-Request-Id per order), so the page and
 * CHECKOUT.ORDER.APPROVED can both capture without charging twice.
 *
 * PAYPAL_ENVIRONMENT picks sandbox or live (default sandbox, so a forgotten
 * variable never takes real money).
 */

export type PaypalEnvironment = "sandbox" | "live";

export const paypalEnvironment = (): PaypalEnvironment => (process.env.PAYPAL_ENVIRONMENT === "live" ? "live" : "sandbox");

/** PayPal's REST host for PAYPAL_ENVIRONMENT. */
const API_BASE: Record<PaypalEnvironment, string> = { sandbox: "https://api-m.sandbox.paypal.com", live: "https://api-m.paypal.com" };

const TIMEOUT_MS = 20_000;

// ---------------------------------------------------------------------------
// PayPal's REST API
// ---------------------------------------------------------------------------

/** A PayPal API error: its HTTP status and the first `issue` code (e.g. ORDER_ALREADY_CAPTURED). */
export class PaypalError extends Error {
  readonly status: number;
  readonly issue: string | undefined;
  constructor(status: number, issue: string | undefined, message: string) {
    super(message);
    this.name = "PaypalError";
    this.status = status;
    this.issue = issue;
  }
}

const ErrorBody = z.object({
  name: z.string().optional(),
  message: z.string().optional(),
  error_description: z.string().optional(),
  details: z.array(z.object({ issue: z.string().optional() })).optional(),
});

const Token = z.object({ access_token: z.string(), expires_in: z.number() });

let token: { value: string; expiresAt: number } | null = null;

const accessToken = async (): Promise<string> => {
  if (token && token.expiresAt > Date.now()) return token.value;
  const basic = Buffer.from(`${process.env.PAYPAL_CLIENT_ID ?? ""}:${process.env.PAYPAL_CLIENT_SECRET ?? ""}`).toString("base64");
  const res = await fetch(`${API_BASE[paypalEnvironment()]}/v1/oauth2/token`, {
    method: "POST",
    headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = ErrorBody.safeParse(body);
    throw new PaypalError(res.status, undefined, `PayPal sign-in failed: ${err.success ? (err.data.error_description ?? err.data.message ?? res.status) : res.status}`);
  }
  const t = Token.parse(body);
  // a minute early, so a token never expires mid-request
  token = { value: t.access_token, expiresAt: Date.now() + Math.max(0, t.expires_in - 60) * 1000 };
  return token.value;
};

const call = async <T>(schema: z.ZodType<T>, method: "GET" | "POST", path: string, body?: unknown, requestId?: string): Promise<T> => {
  const res = await fetch(`${API_BASE[paypalEnvironment()]}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${await accessToken()}`,
      "content-type": "application/json",
      prefer: "return=representation",
      ...(requestId ? { "paypal-request-id": requestId } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = ErrorBody.safeParse(json);
    const issue = err.success ? err.data.details?.[0]?.issue : undefined;
    throw new PaypalError(res.status, issue, `PayPal ${method} ${path}: ${res.status}${issue ? ` ${issue}` : ""}`);
  }
  return schema.parse(json);
};

const Money = z.object({ currency_code: z.string(), value: z.string() });

const Capture = z.object({
  id: z.string(),
  status: z.string(),
  amount: Money.optional(),
  supplementary_data: z.object({ related_ids: z.object({ order_id: z.string().optional() }).optional() }).optional(),
});

export const Order = z.object({
  id: z.string(),
  status: z.string(),
  purchase_units: z
    .array(
      z.object({
        custom_id: z.string().optional(),
        amount: Money.optional(),
        payments: z.object({ captures: z.array(Capture).optional() }).optional(),
      })
    )
    .default([]),
  links: z.array(z.object({ href: z.string(), rel: z.string() })).default([]),
});
export type Order = z.infer<typeof Order>;

const getOrder = (orderId: string): Promise<Order> => call(Order, "GET", `/v2/checkout/orders/${encodeURIComponent(orderId)}`);

/** Capture an approved order. Safe to call twice: the same request id returns the first capture, and an order captured already is read back. */
const captureOrder = async (orderId: string): Promise<Order> => {
  try {
    return await call(Order, "POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {}, `capture-${orderId}`);
  } catch (error) {
    if (error instanceof PaypalError && error.issue === "ORDER_ALREADY_CAPTURED") return getOrder(orderId);
    throw error;
  }
};

// ---------------------------------------------------------------------------
// Orders and our books (pure over BillingStore, so tested without PayPal)
// ---------------------------------------------------------------------------

export type Buyer = { userId: string; sku: string; projectId: string | null };

/** `custom_id`: "<user id> <sku> [<project id>]" (PayPal allows 127 characters). */
export const buyerId = (b: Buyer): string => [b.userId, b.sku, ...(b.projectId ? [b.projectId] : [])].join(" ");

export const buyerOf = (order: Order): Buyer | null => {
  const [userId, sku, projectId] = (order.purchase_units[0]?.custom_id ?? "").split(" ");
  return userId && sku ? { userId, sku, projectId: projectId || null } : null;
};

/** "15.00" for 1500 cents. */
export const usd = (cents: number): string => (cents / 100).toFixed(2);

export const paymentRef = (orderId: string): string => `paypal:${orderId}`;

/** The order's completed capture, if the money has gone through. */
export const completedCapture = (order: Order) => order.purchase_units[0]?.payments?.captures?.find((c) => c.status === "COMPLETED");

/**
 * A captured order onto our books: the pack's credits, once per order. Only
 * orders this server made count (their custom_id names a pack), and only when
 * PayPal took the pack's full price in USD.
 */
export const applyOrder = async (store: BillingStore, order: Order): Promise<Outcome> => {
  const buyer = buyerOf(order);
  const product = buyer ? productBySku(buyer.sku) : undefined;
  if (!buyer || product?.kind !== "pack") return { applied: false, note: `order ${order.id}: not one of ours` };
  const capture = completedCapture(order);
  if (!capture) return { applied: false, note: `order ${order.id}: not captured (${order.status})` };
  if (capture.amount?.currency_code !== "USD" || capture.amount.value !== usd(product.priceCents)) {
    return { applied: false, note: `order ${order.id}: paid ${capture.amount?.value ?? "?"} ${capture.amount?.currency_code ?? ""}, not the ${product.sku} price` };
  }
  if (!(await store.userExists(buyer.userId))) throw new RetryLater(`order ${order.id}: no user yet`);
  return grantPacks(store, buyer.userId, [{ pack: product as Pack, quantity: 1 }], paymentRef(order.id));
};

const applied = async (order: Order): Promise<Outcome> => {
  const outcome = await applyOrder(dbStore, order);
  const buyer = buyerOf(order);
  notePaid({ userId: buyer?.userId, projectId: buyer?.projectId }, outcome);
  return outcome;
};

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

const requireBilling = (): void => {
  if (!billingEnabled()) throw new HttpError(503, "Payments aren't switched on yet.");
};

/**
 * An order for one credit pack. `url`: PayPal's approval page, for a browser
 * redirect or a link an AI agent hands its user; `orderId`: for the PayPal
 * JS SDK's buttons. `projectId`: a free preview waiting for this purchase,
 * which the browser goes back to (and finishes) after paying.
 */
export const createOrder = async (account: Account, sku: string, projectId?: string): Promise<{ url: string; orderId: string }> => {
  requireBilling();
  const product = productBySku(sku);
  if (!product) throw new HttpError(400, "That plan isn't available.");
  if (product.kind !== "pack") throw new HttpError(400, "Plans aren't sold here: pick a credit pack.");
  const back = projectId ? `/p/${projectId}` : "/billing";
  const order = await call(
    Order,
    "POST",
    "/v2/checkout/orders",
    {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: sku,
          custom_id: buyerId({ userId: account.id, sku, projectId: projectId ?? null }),
          description: `XLaunch ${product.name} (${product.credits.toLocaleString("en-US")} credits)`,
          amount: { currency_code: "USD", value: usd(product.priceCents) },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: "XLaunch",
            user_action: "PAY_NOW",
            shipping_preference: "NO_SHIPPING",
            // PayPal adds token=<order id>; the page asks us for the real outcome (checkoutStatus)
            return_url: `${config.appOrigin}${back}?checkout=done&sku=${encodeURIComponent(sku)}`,
            cancel_url: `${config.appOrigin}${back}?checkout=cancelled&sku=${encodeURIComponent(sku)}`,
          },
        },
      },
    },
    `order-${account.id}-${Date.now()}`
  );
  const url = order.links.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href;
  if (!url) throw new HttpError(502, "Checkout didn't start. Try again.");
  return { url, orderId: order.id };
};

export type OrderStatus = { state: "paid" | "pending" | "failed"; credited: boolean; sku: string | null; balance: number };

const FAILED_CAPTURE: Record<string, true> = { DECLINED: true, FAILED: true };

/**
 * The real outcome of the caller's order (only their own: its custom_id
 * names them). An approved order is captured here; a captured one is put on
 * the books if no webhook has yet (once per order).
 */
export const orderStatus = async (account: Account, orderId: string): Promise<OrderStatus> => {
  requireBilling();
  let order = await getOrder(orderId).catch(() => null);
  const buyer = order ? buyerOf(order) : null;
  if (!order || buyer?.userId !== account.id) throw new HttpError(404, "That checkout isn't on this account.");
  let state: OrderStatus["state"] = "pending";
  if (order.status === "APPROVED") {
    try {
      order = await captureOrder(orderId);
    } catch (error) {
      // the buyer's card or account was turned down at capture: nothing was charged
      if (error instanceof PaypalError && error.status === 422) state = "failed";
      else throw error;
    }
  }
  let credited = false;
  if (completedCapture(order)) {
    state = "paid";
    const outcome = await applied(order);
    credited = outcome.applied || /already granted/.test(outcome.note);
  } else if (order.status === "VOIDED" || order.purchase_units[0]?.payments?.captures?.some((c) => FAILED_CAPTURE[c.status])) {
    state = "failed";
  }
  return { state, credited, sku: buyer.sku, balance: (await balanceOf(account.id)).total };
};

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

const Event = z.object({ id: z.string(), event_type: z.string(), resource: z.unknown() });

const Verification = z.object({ verification_status: z.string() });

const Refund = z.object({ id: z.string(), links: z.array(z.object({ href: z.string(), rel: z.string() })).default([]) });

const HEADERS = ["paypal-auth-algo", "paypal-cert-url", "paypal-transmission-id", "paypal-transmission-sig", "paypal-transmission-time"] as const;
export const PAYPAL_WEBHOOK_HEADERS: readonly string[] = HEADERS;

/** Asks PayPal whether this delivery is really from it, for our webhook (PAYPAL_WEBHOOK_ID). */
const verify = async (headers: Record<string, string>, event: unknown): Promise<boolean> => {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId || HEADERS.some((h) => !headers[h])) return false;
  const r = await call(Verification, "POST", "/v1/notifications/verify-webhook-signature", {
    auth_algo: headers["paypal-auth-algo"],
    cert_url: headers["paypal-cert-url"],
    transmission_id: headers["paypal-transmission-id"],
    transmission_sig: headers["paypal-transmission-sig"],
    transmission_time: headers["paypal-transmission-time"],
    webhook_id: webhookId,
    webhook_event: event,
  });
  return r.verification_status === "SUCCESS";
};

/** A full refund takes the order's credits back; a partial one is a goodwill gesture decided by hand, credits stay. */
const onRefund = async (resource: unknown): Promise<Outcome> => {
  const refund = Refund.parse(resource);
  const captureUrl = refund.links.find((l) => l.rel === "up")?.href;
  const captureId = captureUrl ? /\/captures\/([^/?]+)/.exec(captureUrl)?.[1] : undefined;
  if (!captureId) return { applied: false, note: `refund ${refund.id}: no capture` };
  const capture = await call(Capture, "GET", `/v2/payments/captures/${encodeURIComponent(captureId)}`);
  const orderId = capture.supplementary_data?.related_ids?.order_id;
  if (!orderId) return { applied: false, note: `refund ${refund.id}: no order` };
  if (capture.status !== "REFUNDED") return { applied: false, note: `refund ${refund.id}: partial, credits kept` };
  const taken = await dbStore.revoke(grantRef(paymentRef(orderId)), `refund ${refund.id}`);
  return { applied: taken, note: taken ? `refund ${refund.id}: credits revoked` : `refund ${refund.id}: nothing to revoke` };
};

/**
 * Verify and apply one delivery. Throws BadSignature (answer 401) or
 * RetryLater / any other error (answer 5xx, PayPal delivers again). A
 * delivery already applied is skipped; every credit change is idempotent besides.
 */
export const handlePaypalWebhook = async (rawBody: string, headers: Record<string, string>): Promise<Outcome> => {
  requireBilling();
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new BadSignature("Not a PayPal event.");
  }
  const event = Event.safeParse(parsed);
  if (!event.success || !(await verify(headers, parsed))) throw new BadSignature("Webhook signature did not verify.");
  const { id, event_type: type, resource } = event.data;
  const deliveryId = `paypal:${id}`;
  if (must(await db().from("billing_events").select("webhook_id").eq("webhook_id", deliveryId).maybeSingle(), "seen webhook")) {
    return { applied: false, note: `${deliveryId}: already applied` };
  }
  let outcome: Outcome;
  if (type === "CHECKOUT.ORDER.APPROVED") {
    // the buyer approved but may never come back to our page: capture here
    outcome = await applied(await captureOrder(Order.parse(resource).id));
  } else if (type === "PAYMENT.CAPTURE.COMPLETED") {
    const orderId = Capture.parse(resource).supplementary_data?.related_ids?.order_id;
    outcome = orderId ? await applied(await getOrder(orderId)) : { applied: false, note: `${type}: no order` };
  } else if (type === "PAYMENT.CAPTURE.REFUNDED") {
    outcome = await onRefund(resource);
  } else {
    outcome = { applied: false, note: `${type}: nothing to do` };
  }
  // recorded only once applied, so a delivery that failed part-way runs again on retry
  must(await db().from("billing_events").upsert({ webhook_id: deliveryId, type, payload: parsed }), "record webhook");
  return outcome;
};
