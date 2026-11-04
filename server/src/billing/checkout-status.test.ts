import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Account } from "../auth";

/** Back from checkout: the outcome is asked of Dodo by id, for the caller's own checkout only. */

const payments = new Map<string, Record<string, unknown>>();
const subscriptions = new Map<string, Record<string, unknown>>();
const applied: string[] = [];
const sessions: Array<Record<string, unknown>> = [];

vi.mock("dodopayments", () => ({
  default: class {
    payments = {
      retrieve: async (id: string) => {
        const p = payments.get(id);
        if (!p) throw new Error("404");
        return p;
      },
      list: async ({ subscription_id }: { subscription_id?: string }) => ({
        items: [...payments.values()].filter((p) => p.subscription_id === subscription_id),
      }),
    };
    checkoutSessions = {
      create: async (body: Record<string, unknown>) => {
        sessions.push(body);
        return { checkout_url: "https://checkout.test/s" };
      },
    };
    subscriptions = {
      retrieve: async (id: string) => {
        const s = subscriptions.get(id);
        if (!s) throw new Error("404");
        return s;
      },
    };
  },
}));
vi.mock("./events", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./events")>()),
  applyEvent: async (_store: unknown, e: { type: string; data: { payment_id?: string; subscription_id?: string } }) => {
    applied.push(`${e.type}:${e.data.payment_id ?? e.data.subscription_id}`);
    return { applied: true, note: "granted" };
  },
}));
vi.mock("./credits", () => ({ billingEnabled: () => true, balanceOf: async () => ({ sub: 0, pack: 1400, total: 1400 }) }));
vi.mock("./catalog", async (importOriginal) => ({ ...(await importOriginal<typeof import("./catalog")>()), productIdFor: () => "pdt_x" }));
vi.mock("../db", () => ({ db: () => ({}), must: (r: unknown) => r, dbEnabled: () => false }));

const { checkoutStatus, createCheckout } = await import("./dodo");
const me = { id: "u1", email: "me@x.com" } as Account;

describe("checkout status", () => {
  beforeEach(() => {
    payments.clear();
    subscriptions.clear();
    applied.length = 0;
  });

  it("a paid pack: applied here if the webhook hasn't, and credited", async () => {
    payments.set("pay_1", { payment_id: "pay_1", status: "succeeded", metadata: { user_id: "u1", sku: "pack_single" }, created_at: "2026-10-14T10:00:00Z" });
    expect(await checkoutStatus(me, { paymentId: "pay_1" })).toEqual({ state: "paid", credited: true, sku: "pack_single", balance: 1400 });
    expect(applied).toEqual(["payment.succeeded:pay_1"]);
  });

  it("a failed payment says failed and adds nothing (whatever the return URL claimed)", async () => {
    payments.set("pay_2", { payment_id: "pay_2", status: "failed", metadata: { user_id: "u1", sku: "pack_pro" }, created_at: "2026-10-14T10:00:00Z" });
    expect(await checkoutStatus(me, { paymentId: "pay_2" })).toMatchObject({ state: "failed", credited: false, sku: "pack_pro" });
    expect(applied).toEqual([]);
  });

  it("a payment still processing is pending", async () => {
    payments.set("pay_3", { payment_id: "pay_3", status: "processing", metadata: { user_id: "u1" }, created_at: "2026-10-14T10:00:00Z" });
    expect(await checkoutStatus(me, { paymentId: "pay_3" })).toMatchObject({ state: "pending", credited: false });
  });

  it("someone else's payment is not found, and nothing is applied", async () => {
    payments.set("pay_4", { payment_id: "pay_4", status: "succeeded", metadata: { user_id: "u2" }, created_at: "2026-10-14T10:00:00Z" });
    await expect(checkoutStatus(me, { paymentId: "pay_4" })).rejects.toMatchObject({ status: 404 });
    await expect(checkoutStatus(me, { paymentId: "pay_missing" })).rejects.toMatchObject({ status: 404 });
    expect(applied).toEqual([]);
  });

  it("a plan: its subscription is recorded, its first payment says whether it went through", async () => {
    subscriptions.set("sub_1", { subscription_id: "sub_1", status: "active", product_id: "pdt_x", metadata: { user_id: "u1" } });
    payments.set("pay_5", { payment_id: "pay_5", subscription_id: "sub_1", status: "succeeded", metadata: {}, created_at: "2026-10-14T10:00:00Z" });
    expect(await checkoutStatus(me, { subscriptionId: "sub_1" })).toMatchObject({ state: "paid", credited: true });
    expect(applied).toEqual(["subscription.active:sub_1", "payment.succeeded:pay_5"]);
  });

  it("a plan whose payment failed is failed; someone else's plan is not found", async () => {
    subscriptions.set("sub_2", { subscription_id: "sub_2", status: "failed", product_id: "pdt_x", metadata: { user_id: "u1" } });
    payments.set("pay_6", { payment_id: "pay_6", subscription_id: "sub_2", status: "failed", metadata: {}, created_at: "2026-10-14T10:00:00Z" });
    expect(await checkoutStatus(me, { subscriptionId: "sub_2" })).toMatchObject({ state: "failed", credited: false });
    subscriptions.set("sub_3", { subscription_id: "sub_3", status: "active", product_id: "pdt_x", metadata: { user_id: "u2" } });
    await expect(checkoutStatus(me, { subscriptionId: "sub_3" })).rejects.toMatchObject({ status: 404 });
  });

  it("a payment id that belongs to another subscription is refused", async () => {
    subscriptions.set("sub_4", { subscription_id: "sub_4", status: "active", product_id: "pdt_x", metadata: { user_id: "u1" } });
    payments.set("pay_7", { payment_id: "pay_7", subscription_id: "sub_other", status: "succeeded", metadata: { user_id: "u2" }, created_at: "2026-10-14T10:00:00Z" });
    // both ids given: the payment must be the caller's own
    await expect(checkoutStatus(me, { paymentId: "pay_7", subscriptionId: "sub_4" })).rejects.toMatchObject({ status: 404 });
  });

  it("another user's payment with that user's own subscription is refused (the subscription is checked too)", async () => {
    subscriptions.set("sub_v", { subscription_id: "sub_v", status: "active", product_id: "pdt_x", metadata: { user_id: "u2" } });
    payments.set("pay_v", { payment_id: "pay_v", subscription_id: "sub_v", status: "succeeded", metadata: { user_id: "u2" }, created_at: "2026-10-14T10:00:00Z" });
    await expect(checkoutStatus(me, { paymentId: "pay_v", subscriptionId: "sub_v" })).rejects.toMatchObject({ status: 404 });
    expect(applied).toEqual([]);
  });

  it("a checkout for a waiting preview goes back to it; otherwise to the Credits page", async () => {
    sessions.length = 0;
    await createCheckout(me, "pack_single", "abc123");
    await createCheckout(me, "pack_single");
    expect(sessions[0].metadata).toEqual({ user_id: "u1", sku: "pack_single", project_id: "abc123" });
    expect(String(sessions[0].return_url)).toMatch(/\/p\/abc123\?checkout=done&sku=pack_single$/);
    expect(String(sessions[0].cancel_url)).toMatch(/\/p\/abc123\?checkout=cancelled/);
    expect(String(sessions[1].return_url)).toMatch(/\/billing\?checkout=done/);
  });

  it("never guesses a name from the email, and hides the discount-code box", async () => {
    sessions.length = 0;
    await createCheckout(me, "pack_one", "abc123");
    expect(sessions[0].customer).toEqual({ email: "me@x.com" });
    expect(sessions[0].feature_flags).toEqual({ allow_discount_code: false });
  });
});
