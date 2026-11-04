"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Clock, X, XCircle } from "lucide-react";

import { gaEvent } from "@/components/Analytics";
import { Button, Spinner } from "@/components/ui";
import { api, type BillingProduct } from "@/lib/api";
import { track } from "@/lib/funnel";

/** GA4's ecommerce fields for a product: its catalog price in USD. Nothing when the product isn't known. */
const gaProduct = (product: BillingProduct | undefined) =>
  product
    ? { currency: "USD", value: product.priceCents / 100, items: [{ item_id: product.sku, item_name: product.name, price: product.priceCents / 100, quantity: 1 }] }
    : {};

/** GA's `begin_checkout`: call as a checkout for `sku` starts (paywall, Credits page, a retry). */
export const gaBeginCheckout = (sku: string, products: BillingProduct[]) => gaEvent("begin_checkout", gaProduct(products.find((p) => p.sku === sku)));

/**
 * How the browser came back from PayPal (read off the return URL once, then
 * cleared): PayPal adds the order id as `token`. The PayPal buttons on the
 * Credits page make one too, from their onApprove.
 */
export type CheckoutReturn = { kind: "done" | "cancelled"; orderId?: string; sku?: string };

/** The return URL's checkout fields, or null when the page wasn't opened from a checkout. */
export const readCheckoutReturn = (search: string): CheckoutReturn | null => {
  const q = new URLSearchParams(search);
  const kind = q.get("checkout");
  if (kind !== "done" && kind !== "cancelled") return null;
  const token = q.get("token");
  return { kind, orderId: token && /^[A-Za-z0-9_-]{4,80}$/.test(token) ? token : undefined, sku: q.get("sku") ?? undefined };
};

type View =
  | { step: "checking" }
  | { step: "adding" }
  | { step: "paid"; balance: number }
  | { step: "slow" }
  | { step: "failed" }
  | { step: "cancelled" }
  | { step: "unknown" };

/** Ask every 3 s for up to 2 minutes: a card payment settles in seconds, some methods take longer. */
const EVERY_MS = 3_000;
const TRIES = 40;

/**
 * Back from checkout: a small window with what really happened, asked of
 * the server (never the return URL's own `status`, which the browser could
 * change). Paid: the credits, once they are on the balance. Failed or
 * cancelled: nothing was charged, try again. Still processing: the credits
 * arrive by themselves when it clears.
 */
export function CheckoutResult({
  back,
  products,
  onRetry,
  onClose,
  onCredited,
  paidNote,
}: {
  back: CheckoutReturn;
  products: BillingProduct[];
  onRetry: (sku: string) => void;
  onClose: () => void;
  /** Credits landed: refresh the balance on the page (or start the render the purchase was for). */
  onCredited: () => void;
  /** A line after "Payment received" (e.g. "Rendering your video now."), in place of the balance. */
  paidNote?: string;
}) {
  const [view, setView] = useState<View>(back.kind === "cancelled" ? { step: "cancelled" } : back.orderId ? { step: "checking" } : { step: "unknown" });
  const [sku, setSku] = useState(back.sku);
  const closeButton = useRef<HTMLButtonElement>(null);
  const product = products.find((p) => p.sku === sku);
  const name = product ? (product.kind === "subscription" ? `the ${product.tier[0].toUpperCase()}${product.tier.slice(1)} plan` : `the ${product.name}`) : "your purchase";
  const counted = useRef(false);
  const purchased = useRef(false);

  useEffect(() => {
    if (back.kind !== "cancelled" || counted.current) return;
    counted.current = true;
    track("checkout_cancelled");
  }, [back]);

  // GA's purchase, once, when the credits are confirmed (the transaction id dedupes it on GA's side too)
  useEffect(() => {
    if (view.step !== "paid" || purchased.current) return;
    purchased.current = true;
    gaEvent("purchase", { transaction_id: back.orderId, ...gaProduct(product) });
  }, [view.step, back, product]);

  useEffect(() => {
    if (back.kind !== "done" || !back.orderId) return;
    const orderId = back.orderId;
    let stopped = false;
    let tries = 0;
    let timer: number | undefined;
    const tick = async () => {
      tries++;
      try {
        const s = await api.checkoutStatus(orderId);
        if (stopped) return;
        if (s.sku) setSku(s.sku);
        if (s.state === "failed") return setView({ step: "failed" });
        if (s.state === "paid" && s.credited) {
          onCredited();
          return setView({ step: "paid", balance: s.balance });
        }
        setView(s.state === "paid" ? { step: "adding" } : tries > 3 ? { step: "slow" } : { step: "checking" });
      } catch {
        if (stopped) return;
        // not this account's order, or the server can't reach PayPal: say we can't tell, credits still arrive by webhook
        if (tries >= 3) return setView({ step: "unknown" });
      }
      if (tries < TRIES) timer = window.setTimeout(() => void tick(), EVERY_MS);
      // two minutes and no answer: it is still going; the credits arrive by themselves when it clears
      else setView({ step: "slow" });
    };
    void tick();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [back]);

  useEffect(() => {
    closeButton.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  const retry =
    sku && products.some((p) => p.sku === sku)
      ? () => {
          gaBeginCheckout(sku, products);
          onRetry(sku);
        }
      : undefined;
  const body: { icon: React.ReactNode; title: string; text: string; actions: React.ReactNode } = (() => {
    const close = (label = "Close") => (
      <Button ref={closeButton} variant="secondary" onClick={onClose}>
        {label}
      </Button>
    );
    switch (view.step) {
      case "checking":
        return { icon: <Spinner className="size-6 text-accent" />, title: "Confirming your payment…", text: "This takes a few seconds.", actions: close() };
      case "adding":
        return { icon: <Spinner className="size-6 text-accent" />, title: "Payment received", text: `Adding the credits for ${name} to your account…`, actions: close() };
      case "paid":
        return {
          icon: <CheckCircle2 className="size-7 text-[#18904c]" />,
          title: "Payment received",
          text: paidNote ?? `Thank you! The credits for ${name} are in your account: you now have ${view.balance.toLocaleString("en-US")} credits.`,
          actions: (
            <Button ref={closeButton} variant="primary" onClick={onClose}>
              Done
            </Button>
          ),
        };
      case "slow":
        return {
          icon: <Clock className="size-7 text-warn" />,
          title: "Your payment is still processing",
          text: "Some payment methods take a few minutes. The credits are added by themselves as soon as it clears; you can close this.",
          actions: close("Got it"),
        };
      case "failed":
        return {
          icon: <XCircle className="size-7 text-bad" />,
          title: "The payment didn't go through",
          text: "Nothing was charged. Try again, with the same card or another payment method.",
          actions: (
            <>
              {close()}
              {retry && (
                <Button variant="primary" onClick={retry}>
                  Try again
                </Button>
              )}
            </>
          ),
        };
      case "cancelled":
        return {
          icon: <XCircle className="size-7 text-mute" />,
          title: "Checkout cancelled",
          text: "Nothing was charged. You can pick it up again whenever you like.",
          actions: (
            <>
              {close()}
              {retry && (
                <Button variant="primary" onClick={retry}>
                  Try again
                </Button>
              )}
            </>
          ),
        };
      default:
        return {
          icon: <Clock className="size-7 text-mute" />,
          title: "We couldn't confirm the payment here",
          text: "If you paid, the credits are added automatically within a few minutes. If they don't show up, write to us and we'll sort it out.",
          actions: close(),
        };
    }
  })();

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/55 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="checkout-title" className="relative w-full max-w-[420px] rounded-2xl border border-line bg-panel p-6 text-center shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6)]">
        <button type="button" onClick={onClose} aria-label="Close" className="absolute right-3 top-3 grid size-8 cursor-pointer place-items-center rounded-lg text-mute hover:bg-panel-hi hover:text-fg">
          <X className="size-4" />
        </button>
        <div className="mx-auto grid size-12 place-items-center">{body.icon}</div>
        <h2 id="checkout-title" className="mt-3 text-lg font-medium text-fg">
          {body.title}
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-mute" aria-live="polite">
          {body.text}
        </p>
        <div className="mt-5 flex justify-center gap-2">{body.actions}</div>
      </div>
    </div>
  );
}
