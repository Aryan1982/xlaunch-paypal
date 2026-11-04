import type { Account } from "../auth";
import { HttpError } from "../lib/http";
import { productIdFor, productsForSale } from "./catalog";
import { paymentProvider } from "./credits";
import * as dodo from "./dodo";
import * as paypal from "./paypal";

/**
 * Checkout, whoever takes the payment: Dodo (production) or PayPal
 * (PAYMENT_PROVIDER=paypal, the hackathon server). The routes and the MCP
 * server only call these.
 */

/** sandbox/live (PayPal) or test_mode/live_mode (Dodo). */
export const billingEnvironment = (): string => (paymentProvider() === "paypal" ? paypal.paypalEnvironment() : dodo.dodoEnvironment());

/** What can be bought now: PayPal sells packs; Dodo sells what has a product id in this mode. */
export const productsOnSale = () =>
  paymentProvider() === "paypal" ? productsForSale().filter((p) => p.kind === "pack") : productsForSale().filter((p) => productIdFor(p.sku));

/** `url`: where the buyer approves the payment; `orderId`: a PayPal order, for the PayPal JS SDK's buttons. */
export const createCheckout = async (account: Account, sku: string, projectId?: string): Promise<{ url: string; orderId?: string }> =>
  paymentProvider() === "paypal" ? paypal.createOrder(account, sku, projectId) : { url: await dodo.createCheckout(account, sku, projectId) };

export type CheckoutIds = { paymentId?: string; subscriptionId?: string; orderId?: string };

export const checkoutStatus = async (account: Account, ids: CheckoutIds): Promise<dodo.CheckoutStatus> => {
  if (paymentProvider() === "paypal") {
    if (!ids.orderId) throw new HttpError(400, "No checkout to look up.");
    return paypal.orderStatus(account, ids.orderId);
  }
  return dodo.checkoutStatus(account, ids);
};

/** Dodo can be asked for an account's recent payments; PayPal orders are applied by webhook and by the buyer's page instead. */
export const syncPurchases = (account: Account): Promise<number> => (paymentProvider() === "paypal" ? Promise.resolve(0) : dodo.syncPurchases(account));

export const createPortal = async (account: Account): Promise<string> => {
  if (paymentProvider() === "paypal") throw new HttpError(404, "There's no plan to manage: PayPal purchases are one-time packs.");
  return dodo.createPortal(account);
};
