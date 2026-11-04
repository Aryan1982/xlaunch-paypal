import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Account } from "../auth";
import type { BillingStore } from "./events";
// vi.mock calls below are hoisted above this import
import { applyOrder, buyerId, Order, orderStatus } from "./paypal";

/** PayPal orders onto our books: only our orders, only once, only at the pack's price; the outcome asked of PayPal for the caller's own order. */

const granted: string[] = [];
vi.mock("./books", () => ({
  dbStore: {
    userExists: async (id: string) => id === "u1",
    isFounder: async () => false,
    grant: async (g: { ref: string }) => (granted.includes(g.ref) ? false : (granted.push(g.ref), true)),
    entitle: async () => undefined,
  },
  notePaid: () => undefined,
}));
vi.mock("./credits", () => ({ billingEnabled: () => true, balanceOf: async () => ({ sub: 0, pack: 550, total: 550 }) }));
vi.mock("../db", () => ({ db: () => ({}), must: (r: unknown) => r, dbEnabled: () => true }));

const me = { id: "u1", email: "me@x.com" } as Account;

const order = (over: { status?: string; custom?: string; capture?: { status: string; value: string; currency?: string } | null } = {}) =>
  Order.parse({
    id: "ORDER1",
    status: over.status ?? "COMPLETED",
    purchase_units: [
      {
        custom_id: over.custom ?? buyerId({ userId: "u1", sku: "pack_one", projectId: "p1" }),
        payments:
          over.capture === null
            ? undefined
            : { captures: [{ id: "CAP1", status: over.capture?.status ?? "COMPLETED", amount: { currency_code: over.capture?.currency ?? "USD", value: over.capture?.value ?? "15.00" } }] },
      },
    ],
  });

const books = (): BillingStore & { grants: Array<{ ref: string; pack: number }> } => {
  const grants: Array<{ ref: string; pack: number }> = [];
  return {
    grants,
    userExists: async (id) => id === "u1",
    userIdByEmail: async () => null,
    subscription: async () => null,
    upsertSubscription: async () => undefined,
    isFounder: async () => false,
    grant: async (g) => (grants.some((x) => x.ref === g.ref) ? false : (grants.push({ ref: g.ref, pack: g.pack }), true)),
    revoke: async () => false,
    entitle: async () => undefined,
  };
};

describe("PayPal orders onto the books", () => {
  it("a captured order grants its pack's credits once", async () => {
    const store = books();
    expect(await applyOrder(store, order())).toEqual({ applied: true, note: "pack_one: +550 credits" });
    // the webhook and the buyer's page both apply it: credits only once
    expect((await applyOrder(store, order())).applied).toBe(false);
    expect(store.grants).toEqual([{ ref: "grant:paypal:ORDER1", pack: 550 }]);
  });

  it("nothing until the money is captured, and nothing for an underpaid or other-currency capture", async () => {
    const store = books();
    expect((await applyOrder(store, order({ status: "APPROVED", capture: null }))).applied).toBe(false);
    expect((await applyOrder(store, order({ capture: { status: "PENDING", value: "15.00" } }))).applied).toBe(false);
    expect((await applyOrder(store, order({ capture: { status: "COMPLETED", value: "1.00" } }))).note).toMatch(/not the pack_one price/);
    expect((await applyOrder(store, order({ capture: { status: "COMPLETED", value: "15.00", currency: "EUR" } }))).applied).toBe(false);
    expect(store.grants).toEqual([]);
  });

  it("ignores orders that aren't a pack of ours (plans, unknown skus, no buyer)", async () => {
    const store = books();
    expect((await applyOrder(store, order({ custom: buyerId({ userId: "u1", sku: "sub_studio_month", projectId: null }) }))).applied).toBe(false);
    expect((await applyOrder(store, order({ custom: "u1 pack_nope" }))).applied).toBe(false);
    expect((await applyOrder(store, order({ custom: "" }))).applied).toBe(false);
    expect(store.grants).toEqual([]);
  });

  it("an order for a user not in the database yet is retried later", async () => {
    await expect(applyOrder(books(), order({ custom: buyerId({ userId: "u2", sku: "pack_one", projectId: null }) }))).rejects.toThrow(/no user yet/);
  });
});

describe("order status", () => {
  let orders: Map<string, unknown>;
  let captures: number;

  beforeEach(() => {
    granted.length = 0;
    captures = 0;
    orders = new Map();
    vi.stubEnv("PAYPAL_CLIENT_ID", "id");
    vi.stubEnv("PAYPAL_CLIENT_SECRET", "secret");
    vi.stubGlobal("fetch", async (url: string, init: { method: string }) => {
      const path = new URL(url).pathname;
      const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
      if (path === "/v1/oauth2/token") return json(200, { access_token: "t", expires_in: 3600 });
      const m = /^\/v2\/checkout\/orders\/([^/]+)(\/capture)?$/.exec(path);
      const o = m ? orders.get(m[1]) : undefined;
      if (!m || !o) return json(404, { name: "RESOURCE_NOT_FOUND", details: [{ issue: "INVALID_RESOURCE_ID" }] });
      if (m[2] && init.method === "POST") {
        captures++;
        const done = order();
        orders.set(m[1], done);
        return json(201, done);
      }
      return json(200, o);
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("an approved order is captured and credited when the buyer comes back", async () => {
    orders.set("ORDER1", order({ status: "APPROVED", capture: null }));
    expect(await orderStatus(me, "ORDER1")).toEqual({ state: "paid", credited: true, sku: "pack_one", balance: 550 });
    expect(captures).toBe(1);
    // coming back again: already captured and credited, nothing charged or granted twice
    expect(await orderStatus(me, "ORDER1")).toEqual({ state: "paid", credited: true, sku: "pack_one", balance: 550 });
    expect(captures).toBe(1);
    expect(granted).toEqual(["grant:paypal:ORDER1"]);
  });

  it("an order not approved yet is pending, and is never captured", async () => {
    orders.set("ORDER1", order({ status: "PAYER_ACTION_REQUIRED", capture: null }));
    expect((await orderStatus(me, "ORDER1")).state).toBe("pending");
    expect(captures).toBe(0);
  });

  it("only the buyer's own order answers", async () => {
    orders.set("ORDER1", order({ status: "APPROVED", custom: buyerId({ userId: "someone-else", sku: "pack_one", projectId: null }), capture: null }));
    await expect(orderStatus(me, "ORDER1")).rejects.toThrow(/isn't on this account/);
    await expect(orderStatus(me, "MISSING")).rejects.toThrow(/isn't on this account/);
    expect(captures).toBe(0);
  });
});
