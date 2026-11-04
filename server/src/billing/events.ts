import { PACK_STORAGE_MB, STORAGE_MB, packCredits, productBySku, skuForProductId, subscriptionGrant, type Pack, type Plan } from "./catalog";

/**
 * What a Dodo webhook event does to our books. Pure over `BillingStore`, so
 * every path that moves credits is tested without Dodo or a database.
 *
 * Money moves only on payment.succeeded (a first payment and every renewal
 * alike) and refund.succeeded. Subscription events only keep our record of
 * who owns which subscription, which renewals need: a renewal payment carries
 * the subscription id, not always our checkout metadata.
 */

export type Customer = { customer_id?: string; email?: string };

export type PaymentData = {
  payment_id: string;
  subscription_id?: string | null;
  product_cart?: Array<{ product_id: string; quantity: number }> | null;
  metadata?: Record<string, string>;
  customer?: Customer;
};

export type SubscriptionData = {
  subscription_id: string;
  product_id: string;
  status: string;
  next_billing_date?: string | null;
  metadata?: Record<string, string>;
  customer?: Customer;
};

export type RefundData = { payment_id: string; refund_id: string; is_partial: boolean };

export type BillingEvent = { type: string; data: unknown };

export type SubscriptionRow = {
  subscriptionId: string;
  userId: string;
  sku: string;
  status: string;
  nextBillingDate: string | null;
  customerId: string | null;
};

export type BillingStore = {
  userExists(userId: string): Promise<boolean>;
  userIdByEmail(email: string): Promise<string | null>;
  subscription(subscriptionId: string): Promise<{ userId: string; sku: string } | null>;
  upsertSubscription(row: SubscriptionRow): Promise<void>;
  isFounder(userId: string): Promise<boolean>;
  /** Add credits once per ref. Resolves false when the ref was already granted (nothing changed). */
  grant(g: { userId: string; sub: number; pack: number; subCap: number | null; ref: string; reason: string; dodoRef: string }): Promise<boolean>;
  revoke(grantRef: string, reason: string): Promise<boolean>;
  /**
   * A paying customer: name their plan when
   * it's a subscription, and raise their storage to at least `storageMb`.
   */
  entitle(userId: string, e: { plan: string | null; storageMb: number }): Promise<void>;
};

/** Thrown when an event can't be applied yet: answer 5xx so the provider delivers it again. */
export class RetryLater extends Error {}

/** A webhook delivery whose signature didn't verify: answer 401. */
export class BadSignature extends Error {}

export type Outcome = { applied: boolean; note: string };

export const grantRef = (paymentId: string): string => `grant:${paymentId}`;

/** Our user: checkout metadata first, then the subscription we recorded, then the customer's email. */
const resolveUser = async (
  store: BillingStore,
  d: { metadata?: Record<string, string>; customer?: Customer; subscription_id?: string | null }
): Promise<string | null> => {
  const fromMeta = d.metadata?.user_id;
  if (fromMeta && (await store.userExists(fromMeta))) return fromMeta;
  if (d.subscription_id) {
    const sub = await store.subscription(d.subscription_id);
    if (sub) return sub.userId;
  }
  if (d.customer?.email) return store.userIdByEmail(d.customer.email);
  return null;
};

const onPayment = async (store: BillingStore, p: PaymentData): Promise<Outcome> => {
  const userId = await resolveUser(store, p);
  if (!userId) throw new RetryLater(`payment ${p.payment_id}: no user yet`);

  if (p.subscription_id) {
    const fromCart = p.product_cart?.map((i) => skuForProductId(i.product_id)).find(Boolean);
    const sku = fromCart ?? (await store.subscription(p.subscription_id))?.sku;
    const plan = sku ? productBySku(sku) : undefined;
    if (plan?.kind !== "subscription") return { applied: false, note: `payment ${p.payment_id}: not one of our plans` };
    const { credits, cap } = subscriptionGrant(plan as Plan);
    const granted = await store.grant({ userId, sub: credits, pack: 0, subCap: cap, ref: grantRef(p.payment_id), reason: plan.sku, dodoRef: p.payment_id });
    const tier = (plan as Plan).tier;
    await store.entitle(userId, { plan: tier, storageMb: STORAGE_MB[tier] });
    if (!granted) return { applied: false, note: `payment ${p.payment_id}: already granted` };
    return { applied: true, note: `${plan.sku}: +${credits} subscription credits` };
  }

  const packs: Array<{ pack: Pack; quantity: number }> = [];
  for (const item of p.product_cart ?? []) {
    const sku = skuForProductId(item.product_id);
    const product = sku ? productBySku(sku) : undefined;
    if (product?.kind === "pack") packs.push({ pack: product as Pack, quantity: item.quantity });
  }
  if (packs.length === 0) return { applied: false, note: `payment ${p.payment_id}: no packs of ours` };
  return grantPacks(store, userId, packs, p.payment_id);
};

/**
 * Credit packs paid for by one payment (Dodo's or PayPal's), granted once per
 * `paymentId`: the buyer's pack credits (with the Founder's bonus) and pack storage.
 */
export const grantPacks = async (store: BillingStore, userId: string, packs: Array<{ pack: Pack; quantity: number }>, paymentId: string): Promise<Outcome> => {
  const founder = await store.isFounder(userId);
  let credits = 0;
  for (const { pack, quantity } of packs) credits += packCredits(pack, founder) * Math.max(1, quantity);
  const skus = packs.map((p) => p.pack.sku).join("+");
  const granted = await store.grant({ userId, sub: 0, pack: credits, subCap: null, ref: grantRef(paymentId), reason: skus, dodoRef: paymentId });
  await store.entitle(userId, { plan: null, storageMb: PACK_STORAGE_MB });
  if (!granted) return { applied: false, note: `payment ${paymentId}: already granted` };
  return { applied: true, note: `${skus}: +${credits} credits` };
};

const onSubscription = async (store: BillingStore, s: SubscriptionData): Promise<Outcome> => {
  const sku = skuForProductId(s.product_id);
  if (!sku || productBySku(sku)?.kind !== "subscription") return { applied: false, note: `subscription ${s.subscription_id}: not one of our plans` };
  const userId = await resolveUser(store, { ...s, subscription_id: s.subscription_id });
  if (!userId) throw new RetryLater(`subscription ${s.subscription_id}: no user yet`);
  await store.upsertSubscription({
    subscriptionId: s.subscription_id,
    userId,
    sku,
    status: s.status,
    nextBillingDate: s.next_billing_date ?? null,
    customerId: s.customer?.customer_id ?? null,
  });
  return { applied: true, note: `subscription ${s.subscription_id}: ${sku} ${s.status}` };
};

const onRefund = async (store: BillingStore, r: RefundData): Promise<Outcome> => {
  // A partial refund is a goodwill gesture decided by hand; credits stay.
  if (r.is_partial) return { applied: false, note: `refund ${r.refund_id}: partial, credits kept` };
  const taken = await store.revoke(grantRef(r.payment_id), `refund ${r.refund_id}`);
  return { applied: taken, note: taken ? `refund ${r.refund_id}: credits revoked` : `refund ${r.refund_id}: nothing to revoke` };
};

export const applyEvent = async (store: BillingStore, event: BillingEvent): Promise<Outcome> => {
  if (event.type === "payment.succeeded") return onPayment(store, event.data as PaymentData);
  if (event.type.startsWith("subscription.")) return onSubscription(store, event.data as SubscriptionData);
  if (event.type === "refund.succeeded") return onRefund(store, event.data as RefundData);
  return { applied: false, note: `${event.type}: nothing to do` };
};
