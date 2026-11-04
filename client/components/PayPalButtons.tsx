"use client";

import { useEffect, useRef, useState } from "react";

import { Skeleton } from "@/components/ui";

/**
 * PayPal's own checkout buttons (JS SDK): PayPal, Venmo for US buyers, and
 * cards, in PayPal's window over this page. The order is made and captured by
 * our server (Orders v2), never here: `createOrder` asks the server for one,
 * and `onApprove` hands its id back so the server can capture it and add the
 * credits.
 *
 * The SDK renders iframes from paypal.com, which a cross-origin-isolated page
 * (COEP, the video preview's pages) blocks: next.config.ts leaves /billing
 * out of isolation.
 */

type ButtonsOptions = {
  style: Record<string, string | number | boolean>;
  createOrder: () => Promise<string>;
  onApprove: (data: { orderID: string }) => Promise<void>;
  onCancel: () => void;
  onError: (error: unknown) => void;
};

type ButtonsInstance = { render: (el: HTMLElement) => Promise<void>; close: () => Promise<void>; isEligible: () => boolean };

type PayPalNamespace = { Buttons: (options: ButtonsOptions) => ButtonsInstance };

declare global {
  interface Window {
    paypal?: PayPalNamespace;
  }
}

/** One SDK script per client id, shared by every set of buttons on the page. */
const loading = new Map<string, Promise<PayPalNamespace>>();

const loadSdk = (clientId: string): Promise<PayPalNamespace> => {
  const known = loading.get(clientId);
  if (known) return known;
  const params = new URLSearchParams({ "client-id": clientId, currency: "USD", intent: "capture", components: "buttons", "enable-funding": "venmo" });
  const promise = new Promise<PayPalNamespace>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://www.paypal.com/sdk/js?${params}`;
    script.async = true;
    script.onload = () => (window.paypal ? resolve(window.paypal) : reject(new Error("PayPal didn't load.")));
    script.onerror = () => {
      loading.delete(clientId);
      reject(new Error("PayPal didn't load. Check your connection, or turn off a blocker for paypal.com."));
    };
    document.head.appendChild(script);
  });
  loading.set(clientId, promise);
  return promise;
};

export function PayPalButtons({
  clientId,
  createOrder,
  onApproved,
  onCancelled,
  onError,
  disabled,
}: {
  clientId: string;
  /** Our server's order for what is being bought: its PayPal order id. */
  createOrder: () => Promise<string>;
  /** The buyer approved the payment in PayPal: the server captures it from here. */
  onApproved: (orderId: string) => void;
  onCancelled: () => void;
  onError: (message: string) => void;
  disabled?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  // the latest callbacks, without rendering PayPal's buttons again each time the parent renders
  const handlers = useRef({ createOrder, onApproved, onCancelled, onError });
  useEffect(() => {
    handlers.current = { createOrder, onApproved, onCancelled, onError };
  });

  useEffect(() => {
    let closed = false;
    let buttons: ButtonsInstance | null = null;
    void loadSdk(clientId).then(
      async (paypal) => {
        if (closed || !box.current) return;
        buttons = paypal.Buttons({
          style: { layout: "vertical", shape: "rect", height: 40, label: "pay", tagline: false },
          createOrder: () => handlers.current.createOrder(),
          onApprove: async (data) => handlers.current.onApproved(data.orderID),
          onCancel: () => handlers.current.onCancelled(),
          onError: (e) => handlers.current.onError(e instanceof Error ? e.message : "PayPal couldn't take the payment. Try again."),
        });
        await buttons.render(box.current);
        if (!closed) setReady(true);
      },
      (e: unknown) => !closed && handlers.current.onError(e instanceof Error ? e.message : String(e))
    );
    return () => {
      closed = true;
      void buttons?.close().catch(() => undefined);
    };
  }, [clientId]);

  return (
    <div className={disabled ? "pointer-events-none opacity-50" : undefined} aria-busy={!ready}>
      {!ready && <Skeleton className="h-[88px]" />}
      <div ref={box} />
    </div>
  );
}
