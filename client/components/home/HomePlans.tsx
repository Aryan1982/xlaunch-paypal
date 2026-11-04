"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronDown } from "lucide-react";

import { gaBeginCheckout } from "@/components/CheckoutResult";
import { OfferBanner, PriceTag, savePercent, usd } from "@/components/LaunchPricing";
import { Spinner, cn } from "@/components/ui";
import { api } from "@/lib/api";
import { loginHref } from "@/lib/funnel";
import { videosFor, type Pricing } from "@/lib/pricing";
import { GUARANTEE } from "@/lib/site";
import { useSignedIn } from "@/lib/use-signed-in";

const num = (n: number) => n.toLocaleString("en-US");

const Item = ({ children }: { children: ReactNode }) => (
  <li className="flex gap-2">
    <Check className="mt-0.5 size-4 shrink-0 text-accent" /> {children}
  </li>
);

/**
 * Credit packs, on the home page and /pricing, paid with PayPal. It leads
 * with One video (pay once); "See all credit packs" opens the rest, launch
 * prices beside the regular ones, and `more` (the cost by model).
 * `open`: everything shown from the start (/pricing).
 *
 * Signed in, a button opens PayPal's checkout; signed out, it goes through
 * sign-in to the Credits page, which opens the same checkout (?buy=sku).
 */
export function HomePlans({ pricing, open = false, more }: { pricing: Pricing; open?: boolean; more?: ReactNode }) {
  const router = useRouter();
  const signedIn = useSignedIn();
  const [all, setAll] = useState(open);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const packs = pricing.products.filter((p) => p.kind === "pack");
  // One video leads (the cheapest pack on a server that doesn't sell it yet)
  const one = packs.find((p) => p.sku === "pack_one") ?? [...packs].sort((a, b) => a.priceCents - b.priceCents)[0];
  const otherPacks = packs.filter((p) => p !== one);
  // a video, priced as One video sells it: its credits make one
  const perVideo = one?.credits ?? 0;

  const buy = async (sku: string) => {
    setError(null);
    const there = `/billing?buy=${encodeURIComponent(sku)}`;
    if (signedIn !== true) {
      router.push(loginHref("pricing", there));
      return;
    }
    setPending(sku);
    gaBeginCheckout(sku, pricing.products);
    try {
      window.location.assign((await api.checkout(sku)).url);
    } catch (e) {
      setPending(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const card = "flex flex-col rounded-2xl bg-panel p-6 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.6)]";

  return (
    <>
      <div className="mx-auto grid max-w-[380px] gap-4">
        {one && (
          <div className={cn(card, "relative ring-2 ring-accent/70")}>
            <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-accent px-3 py-1 text-[11px] font-semibold text-white shadow">Start here</span>
            <h3 className="font-medium text-fg">{one.name}</h3>
            <div className="mt-3">
              <PriceTag cents={one.priceCents} regularCents={one.regularPriceCents} note="Pay once, no subscription" />
            </div>
            <ul className="mt-4 flex flex-1 flex-col gap-2 text-sm text-mute">
              <Item>Finish your free preview, or make a new video</Item>
              <Item>{num(one.credits)} credits that never expire</Item>
              <Item>About one 30-second video; the model you pick sets the exact cost</Item>
            </ul>
            <button
              type="button"
              onClick={() => void buy(one.sku)}
              disabled={pending !== null}
              className="mt-6 flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg bg-fg px-4 text-sm font-medium text-bg transition-all hover:bg-fg/85 active:scale-[0.98] disabled:opacity-60"
            >
              {pending === one.sku && <Spinner className="size-4" />}
              Get one video · {usd(one.priceCents)}
            </button>
          </div>
        )}
      </div>
      {perVideo > 0 && (
        <p className="mx-auto mt-5 max-w-[680px] text-center text-sm leading-relaxed text-[color:var(--hero-fg-mute)]">
          A video here is {num(perVideo)} credits, what One video gives you. The model you pick sets what each video really uses.
        </p>
      )}
      <p className="mx-auto mt-3 max-w-[680px] text-center text-sm leading-relaxed text-[color:var(--hero-fg-mute)]">
        {GUARANTEE}{" "}
        <Link href="/refunds" className="py-1.5 underline underline-offset-2 sm:no-underline sm:hover:underline">
          Refund policy
        </Link>
      </p>

      {!all ? (
        <div className="mt-8 text-center">
          <button
            type="button"
            onClick={() => setAll(true)}
            aria-expanded={false}
            className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-panel/95 px-5 py-2.5 text-sm font-medium text-fg shadow-[0_10px_30px_-10px_rgba(0,0,0,0.5)] transition-transform hover:-translate-y-0.5"
          >
            See all credit packs <ChevronDown className="size-4" />
          </button>
        </div>
      ) : (
        <div className="mt-14">
          {pricing.offer && <OfferBanner offer={pricing.offer} save={Math.max(0, ...pricing.products.map((p) => savePercent(p.priceCents, p.regularPriceCents)))} className="mb-8" />}
          {otherPacks.length > 0 && (
            <>
              <div className="text-center">
                <h3 className="text-[20px] font-medium tracking-tight text-[color:var(--hero-fg)]">Every credit pack</h3>
                <p className="mt-1.5 text-sm text-[color:var(--hero-fg-mute)]">Pay once with PayPal, Venmo or a card. Pack credits never expire.</p>
              </div>
              <div className="mt-6 grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 sm:gap-4 lg:grid-cols-4">
                {otherPacks.map((pack) => {
                  const founder = pack.sku === "pack_founder";
                  return (
                    <div
                      key={pack.sku}
                      className={`flex flex-col rounded-2xl bg-panel p-5 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.6)] ring-1 ${founder ? "ring-accent/60" : "ring-line"}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-fg">{pack.name}</span>
                        {founder && <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-medium text-accent">Best value</span>}
                      </div>
                      <div className="mt-2">
                        <PriceTag cents={pack.priceCents} regularCents={pack.regularPriceCents} size="md" />
                      </div>
                      <div className="mt-2 flex-1 text-sm text-mute">
                        {num(pack.credits)} credits
                        <div className="mt-0.5 text-xs text-dim">{videosFor(pack.credits, pricing.costs)}</div>
                        {founder && <div className="mt-1.5 text-xs text-accent">+20% on every pack you buy after</div>}
                      </div>
                      <button
                        type="button"
                        onClick={() => void buy(pack.sku)}
                        disabled={pending !== null}
                        className="mt-4 flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg bg-panel-hi px-3 text-sm font-medium text-fg transition-all hover:bg-line active:scale-[0.98] disabled:opacity-60 sm:h-9"
                      >
                        {pending === pack.sku && <Spinner className="size-4" />}
                        Buy pack
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
          {more}
        </div>
      )}
      {error && <p className="mt-4 text-center text-sm text-bad">{error}</p>}
    </>
  );
}
