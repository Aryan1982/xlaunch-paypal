import { beforeEach, describe, expect, it } from "vitest";

process.env.DODO_PRODUCTS = JSON.stringify({
  sub_studio_month: "pdt_studio_m",
  sub_launch_year: "pdt_launch_y",
  pack_pro: "pdt_pro",
  pack_founder: "pdt_founder",
});

import { applyEvent, grantRef, RetryLater, type BillingStore, type SubscriptionRow } from "./events";

const USER = "user-1";

/** In-memory books with the same idempotency and cap rules as db/002_credits.sql. */
const memoryStore = () => {
  const grants = new Map<string, { userId: string; sub: number; pack: number }>();
  const subs = new Map<string, SubscriptionRow>();
  const balance = new Map<string, { sub: number; pack: number }>();
  const revoked = new Set<string>();
  const acct = (u: string) => balance.get(u) ?? (balance.set(u, { sub: 0, pack: 0 }), balance.get(u)!);
  const plan = { approved: false, plan: "beta", storageMb: 300 };
  const store: BillingStore = {
    entitle: async (_u, e) => {
      plan.approved = true;
      plan.plan = e.plan ?? plan.plan;
      plan.storageMb = Math.max(plan.storageMb, e.storageMb);
    },
    userExists: async (id) => id === USER,
    userIdByEmail: async (email) => (email === "a@b.co" ? USER : null),
    subscription: async (id) => subs.get(id) ?? null,
    upsertSubscription: async (row) => void subs.set(row.subscriptionId, row),
    isFounder: async (u) => [...grants.values()].some((g) => g.userId === u && g.pack >= 30_000),
    grant: async (g) => {
      if (grants.has(g.ref)) return false;
      const a = acct(g.userId);
      const sub = g.subCap === null ? g.sub : Math.max(0, Math.min(g.sub, g.subCap - a.sub));
      a.sub += sub;
      a.pack += g.pack;
      grants.set(g.ref, { userId: g.userId, sub, pack: g.pack });
      return true;
    },
    revoke: async (ref) => {
      const g = grants.get(ref);
      if (!g || revoked.has(ref)) return false;
      const a = acct(g.userId);
      a.sub -= g.sub;
      a.pack -= g.pack;
      revoked.add(ref);
      return true;
    },
  };
  return { store, balance: () => acct(USER), subs, plan };
};

let books: ReturnType<typeof memoryStore>;
beforeEach(() => {
  books = memoryStore();
});

const pay = (data: Record<string, unknown>) => applyEvent(books.store, { type: "payment.succeeded", data });

describe("pack purchases", () => {
  it("grants the pack's credits to the user in the checkout metadata", async () => {
    const out = await pay({ payment_id: "pay_1", product_cart: [{ product_id: "pdt_pro", quantity: 1 }], metadata: { user_id: USER } });
    expect(out.applied).toBe(true);
    expect(books.balance()).toEqual({ sub: 0, pack: 3_900 });
  });

  it("grants once however many times the webhook is delivered, and says so", async () => {
    const event = { payment_id: "pay_1", product_cart: [{ product_id: "pdt_pro", quantity: 1 }], metadata: { user_id: USER } };
    expect(await pay(event)).toEqual({ applied: true, note: "pack_pro: +3900 credits" });
    expect(await pay(event)).toEqual({ applied: false, note: "payment pay_1: already granted" });
    expect(books.balance().pack).toBe(3_900);
  });

  it("adds the Founder's bonus to later packs", async () => {
    await pay({ payment_id: "pay_f", product_cart: [{ product_id: "pdt_founder", quantity: 1 }], metadata: { user_id: USER } });
    await pay({ payment_id: "pay_2", product_cart: [{ product_id: "pdt_pro", quantity: 1 }], metadata: { user_id: USER } });
    expect(books.balance().pack).toBe(30_000 + 4_680);
  });

  it("finds the user by email when metadata is missing", async () => {
    await pay({ payment_id: "pay_1", product_cart: [{ product_id: "pdt_pro", quantity: 1 }], customer: { email: "a@b.co" } });
    expect(books.balance().pack).toBe(3_900);
  });

  it("asks Dodo to retry when it can't tell whose payment it is", async () => {
    await expect(pay({ payment_id: "pay_1", product_cart: [{ product_id: "pdt_pro", quantity: 1 }], customer: { email: "x@y.z" } })).rejects.toBeInstanceOf(RetryLater);
  });

  it("refuses a user id in metadata that doesn't exist", async () => {
    await expect(pay({ payment_id: "pay_1", product_cart: [{ product_id: "pdt_pro", quantity: 1 }], metadata: { user_id: "forged" } })).rejects.toBeInstanceOf(RetryLater);
  });

  it("ignores products that aren't ours", async () => {
    const out = await pay({ payment_id: "pay_1", product_cart: [{ product_id: "pdt_other", quantity: 1 }], metadata: { user_id: USER } });
    expect(out.applied).toBe(false);
    expect(books.balance()).toEqual({ sub: 0, pack: 0 });
  });
});

describe("subscriptions", () => {
  const subEvent = (type: string, status: string, metadata?: Record<string, string>) =>
    applyEvent(books.store, {
      type,
      data: { subscription_id: "sub_1", product_id: "pdt_studio_m", status, metadata, customer: { customer_id: "cus_1" } },
    });

  it("records who owns the subscription, then credits a renewal that carries no metadata", async () => {
    await subEvent("subscription.active", "active", { user_id: USER });
    expect(books.subs.get("sub_1")).toMatchObject({ userId: USER, sku: "sub_studio_month", customerId: "cus_1" });
    await pay({ payment_id: "pay_r2", subscription_id: "sub_1" });
    expect(books.balance().sub).toBe(8_000);
  });

  it("credits a first payment that arrives before subscription.active, using its metadata", async () => {
    await pay({ payment_id: "pay_1", subscription_id: "sub_1", product_cart: [{ product_id: "pdt_studio_m", quantity: 1 }], metadata: { user_id: USER } });
    expect(books.balance().sub).toBe(8_000);
  });

  it("retries a renewal it can't attribute yet rather than dropping it", async () => {
    await expect(pay({ payment_id: "pay_1", subscription_id: "sub_unknown" })).rejects.toBeInstanceOf(RetryLater);
  });

  it("rolls subscription credits over only up to two periods", async () => {
    await subEvent("subscription.active", "active", { user_id: USER });
    for (const id of ["pay_1", "pay_2", "pay_3"]) await pay({ payment_id: id, subscription_id: "sub_1" });
    expect(books.balance().sub).toBe(16_000);
  });

  it("grants a yearly plan's twelve months up front", async () => {
    await pay({ payment_id: "pay_y", subscription_id: "sub_y", product_cart: [{ product_id: "pdt_launch_y", quantity: 1 }], metadata: { user_id: USER } });
    expect(books.balance().sub).toBe(30_000);
  });

  it("keeps the balance when a subscription is cancelled", async () => {
    await subEvent("subscription.active", "active", { user_id: USER });
    await pay({ payment_id: "pay_1", subscription_id: "sub_1" });
    await subEvent("subscription.cancelled", "cancelled");
    expect(books.subs.get("sub_1")?.status).toBe("cancelled");
    expect(books.balance().sub).toBe(8_000);
  });
});

describe("refunds", () => {
  const refundEvent = (is_partial: boolean) =>
    applyEvent(books.store, { type: "refund.succeeded", data: { payment_id: "pay_1", refund_id: "ref_1", is_partial } });

  it("takes back a fully refunded payment's credits, even into a negative balance", async () => {
    await pay({ payment_id: "pay_1", product_cart: [{ product_id: "pdt_pro", quantity: 1 }], metadata: { user_id: USER } });
    expect((await refundEvent(false)).applied).toBe(true);
    expect((await refundEvent(false)).applied).toBe(false);
    expect(books.balance().pack).toBe(0);
  });

  it("leaves credits alone on a partial refund", async () => {
    await pay({ payment_id: "pay_1", product_cart: [{ product_id: "pdt_pro", quantity: 1 }], metadata: { user_id: USER } });
    expect((await refundEvent(true)).applied).toBe(false);
    expect(books.balance().pack).toBe(3_900);
  });

  it("uses the grant ref the database revokes by", () => {
    expect(grantRef("pay_9")).toBe("grant:pay_9");
  });
});

describe("entitlements", () => {
  it("lets a pack buyer in past the waitlist with pack storage, keeping their plan name", async () => {
    await pay({ payment_id: "pay_1", product_cart: [{ product_id: "pdt_pro", quantity: 1 }], metadata: { user_id: USER } });
    expect(books.plan).toEqual({ approved: true, plan: "beta", storageMb: 1_024 });
  });

  it("names a subscriber's plan and gives it the plan's storage", async () => {
    await pay({ payment_id: "pay_1", subscription_id: "sub_1", product_cart: [{ product_id: "pdt_studio_m", quantity: 1 }], metadata: { user_id: USER } });
    expect(books.plan).toEqual({ approved: true, plan: "studio", storageMb: 5_120 });
  });

  it("never lowers storage when a smaller purchase follows a bigger one", async () => {
    await pay({ payment_id: "pay_1", subscription_id: "sub_1", product_cart: [{ product_id: "pdt_studio_m", quantity: 1 }], metadata: { user_id: USER } });
    await pay({ payment_id: "pay_2", product_cart: [{ product_id: "pdt_pro", quantity: 1 }], metadata: { user_id: USER } });
    expect(books.plan).toEqual({ approved: true, plan: "studio", storageMb: 5_120 });
  });

  it("entitles nobody for a payment that isn't ours", async () => {
    await pay({ payment_id: "pay_1", product_cart: [{ product_id: "pdt_other", quantity: 1 }], metadata: { user_id: USER } });
    expect(books.plan.approved).toBe(false);
  });
});

describe("other events", () => {
  it("does nothing for events it doesn't handle", async () => {
    expect(await applyEvent(books.store, { type: "dispute.opened", data: {} })).toEqual({ applied: false, note: "dispute.opened: nothing to do" });
  });
});
