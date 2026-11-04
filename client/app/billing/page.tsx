"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";

import { CheckoutResult, gaBeginCheckout, readCheckoutReturn, type CheckoutReturn } from "@/components/CheckoutResult";
import { OfferBanner, PriceTag, savePercent } from "@/components/LaunchPricing";
import { PayPalButtons } from "@/components/PayPalButtons";
import { ArrowLeft, Box, Coins, Square } from "lucide-react";

import { AccountMenu } from "@/components/AccountMenu";
import { ApiKeys } from "@/components/ApiKeys";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Badge, Button, ErrorBanner, Skeleton, cn } from "@/components/ui";
import { ApiError, api, type Billing, type BillingProduct, type CreditActivity as ActivityRow } from "@/lib/api";
import { useBilling } from "@/lib/use-billing";
import { typicalVideo, videosFor, type LineupModel } from "@/lib/pricing";

const num = (n: number) => n.toLocaleString("en-US");

// AG Grid and AG Charts: this page only, in the browser only
const CreditActivity = dynamic(() => import("@/components/billing/CreditActivity"), {
  ssr: false,
  loading: () => <Skeleton className="mt-10 h-[520px] rounded-2xl" />,
});

type Pack = Extract<BillingProduct, { kind: "pack" }>;

/** The models with their typical costs: the lineup, or (older server) the offered models. */
const lineupOf = (billing: Billing): LineupModel[] =>
  billing.costs.lineup ??
  [
    ...billing.costs.models["2d"].map((m) => ({ ...m, available: true, modes: ["2d" as const] })),
    ...billing.costs.models["3d"].map((m) => ({ ...m, available: true, modes: ["3d" as const] })),
  ];

/** Placeholders in the page's shape while the balance and prices load. */
function LoadingCredits() {
  return (
    <div aria-busy className="mt-6">
      <Skeleton className="h-[132px] rounded-2xl" />
      <Skeleton className="mt-10 h-6 w-24" />
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-[230px] rounded-2xl" />
        ))}
      </div>
      <Skeleton className="mt-10 h-6 w-32" />
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-[170px] rounded-2xl" />
        ))}
      </div>
    </div>
  );
}

const ModeChip = ({ mode }: { mode: "2d" | "3d" }) => (
  <span className="inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-[11px] text-mute">
    {mode === "2d" ? <Square className="size-3" /> : <Box className="size-3" />}
    {mode.toUpperCase()}
  </span>
);

/** Every model and what a video with it typically costs; premium ones not offered yet are marked. */
function ModelTable({ billing }: { billing: Billing }) {
  const rows = lineupOf(billing);
  return (
    <div className="mt-3 overflow-x-auto rounded-2xl border border-line bg-panel">
      <table className="w-full min-w-[520px] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-dim">
            <th className="px-4 py-2.5 font-normal">Model</th>
            <th className="px-4 py-2.5 text-right font-normal">{billing.costs.seconds} s video</th>
            <th className="px-4 py-2.5 text-right font-normal">Scene change</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((m) => (
            <tr key={m.id} className={cn(!m.available && "text-mute")}>
              <td className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn("font-medium", m.available ? "text-fg" : "text-mute")}>{m.label}</span>
                  {m.available ? m.modes.map((mode) => <ModeChip key={mode} mode={mode} />) : <Badge>Coming soon</Badge>}
                </div>
              </td>
              <td className="px-4 py-3 text-right tabular-nums">~{num(m.video)}</td>
              <td className="px-4 py-3 text-right tabular-nums">~{num(m.perScene)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function BillingPage() {
  const { billing, refresh } = useBilling();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  // back from PayPal (its approval page, or the buttons' onApprove): shown in a window that asks the server for the outcome
  const [back, setBack] = useState<CheckoutReturn | null>(null);
  const [activity, setActivity] = useState<ActivityRow[] | null>(null);
  const reload = useCallback(async () => {
    await refresh();
    setActivity(await api.activity().catch(() => []));
  }, [refresh]);

  // Credits come from the server capturing the order (that window) and from PayPal's webhooks; the balance refreshes now and then.
  useEffect(() => {
    // PayPal's buttons can't load on a cross-origin-isolated page (COEP): arriving here from the studio
    // without a page load keeps its isolation, so load this page for real, once
    if (window.crossOriginIsolated && !sessionStorage.getItem("billing-reloaded")) {
      sessionStorage.setItem("billing-reloaded", "1");
      window.location.reload();
      return;
    }
    sessionStorage.removeItem("billing-reloaded");
    const returned = readCheckoutReturn(window.location.search);
    if (returned) {
      window.history.replaceState(null, "", "/billing");
      void Promise.resolve().then(() => setBack(returned));
    }
    const timer = window.setInterval(() => void reload(), 60_000);
    void Promise.resolve().then(reload);
    return () => window.clearInterval(timer);
  }, [reload]);

  const go = async (key: string, open: () => Promise<string>) => {
    setError(null);
    setPending(key);
    try {
      window.location.assign(await open());
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : String(e), code: e instanceof ApiError ? e.code : undefined });
      setPending(null);
    }
  };
  /** To PayPal's approval page (the buttons do the same in a window, without leaving). */
  const checkout = (sku: string) => {
    gaBeginCheckout(sku, billing?.products ?? []);
    return go(sku, () => api.checkout(sku).then((r) => r.url));
  };

  // a link to a section further down (#api-keys) lands once the page has loaded
  const loaded = billing !== null;
  // back from sign-in with a plan or pack chosen on the home page (?buy=sku): straight to its checkout
  useEffect(() => {
    if (!loaded) return;
    const sku = new URLSearchParams(window.location.search).get("buy");
    if (!sku) return;
    window.history.replaceState(null, "", "/billing");
    if (billing?.products.some((p) => p.sku === sku)) void Promise.resolve().then(() => checkout(sku));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);
  useEffect(() => {
    if (!loaded || !window.location.hash) return;
    document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ behavior: "smooth" });
  }, [loaded]);

  const packs = billing?.products.filter((p): p is Pack => p.kind === "pack") ?? [];

  return (
    <div className="min-h-screen bg-bg px-5 py-6">
      <header className="mx-auto flex max-w-[960px] items-center justify-between">
        <Link href="/" className="flex items-center gap-2 text-sm text-mute hover:text-fg">
          <ArrowLeft className="size-4" />
          Back to studio
        </Link>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <AccountMenu />
        </div>
      </header>

      <main className="mx-auto mt-10 max-w-[960px]">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-medium tracking-tight">Credits</h1>
          {billing?.environment === "sandbox" && <Badge tone="warn">PayPal sandbox: no real charges</Badge>}
        </div>

        {!billing ? (
          <LoadingCredits />
        ) : !billing.enabled ? (
          <p className="mt-6 max-w-[520px] text-sm leading-relaxed text-mute">
            Payments aren&apos;t switched on yet. Your monthly allowance is shown in the account menu.
          </p>
        ) : (
          <>
            <section className="mt-6 rounded-2xl border border-line bg-panel p-6">
              <div className="flex items-center gap-2 text-sm text-mute">
                <Coins className="size-4" /> Balance
              </div>
              <div className="mt-1 text-4xl font-medium tabular-nums tracking-tight">{num(billing.balance.total)}</div>
              <div className="mt-1 text-xs text-dim">
                {billing.balance.total < typicalVideo(billing.costs).cheapest
                  ? `Not enough for a video yet: one takes about ${num(typicalVideo(billing.costs).cheapest)} credits with the cheapest model. A pack below tops you up.`
                  : `${num(billing.balance.pack)} from packs (never expire) · ${videosFor(billing.balance.total, billing.costs)}`}
              </div>
            </section>

            {error && (
              <div className="mt-4">
                <ErrorBanner message={error.message} />
              </div>
            )}

            <section className="mt-10">
              {billing.offer && (
                <OfferBanner
                  offer={billing.offer}
                  save={Math.max(0, ...billing.products.map((p) => savePercent(p.priceCents, p.regularPriceCents)))}
                  className="mb-5 max-w-none"
                />
              )}
              <h2 className="text-lg font-medium">Credit packs</h2>
              <p className="mt-1 text-sm text-mute">Pay once with PayPal, Venmo or a card. Pack credits never expire.</p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {packs.map((pack) => (
                  <div key={pack.sku} className="flex flex-col rounded-2xl border border-line bg-panel p-5">
                    <span className="font-medium">{pack.name}</span>
                    <div className="mt-2">
                      <PriceTag cents={pack.priceCents} regularCents={pack.regularPriceCents} size="md" />
                    </div>
                    <div className="mt-1 flex-1 text-sm text-mute">
                      {num(pack.credits)} credits
                      <div className="mt-0.5 text-xs">{videosFor(pack.credits, billing.costs)}</div>
                      {pack.sku === "pack_founder" && <div className="mt-1 text-xs text-accent">+20% on every pack you buy after</div>}
                    </div>
                    <div className="mt-4">
                      {billing.paypalClientId ? (
                        <PayPalButtons
                          clientId={billing.paypalClientId}
                          disabled={pending !== null}
                          createOrder={async () => {
                            setError(null);
                            gaBeginCheckout(pack.sku, billing.products);
                            return (await api.checkout(pack.sku)).orderId;
                          }}
                          onApproved={(orderId) => setBack({ kind: "done", orderId, sku: pack.sku })}
                          onCancelled={() => setBack({ kind: "cancelled", sku: pack.sku })}
                          onError={(message) => setError({ message })}
                        />
                      ) : (
                        <Button className="w-full" size="sm" loading={pending === pack.sku} disabled={pending !== null} onClick={() => void checkout(pack.sku)}>
                          Buy
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {activity ? <CreditActivity rows={activity} /> : <Skeleton className="mt-10 h-[520px] rounded-2xl" />}

            <section className="mt-10">
              <h2 className="text-lg font-medium">Models and what they cost</h2>
              <p className="mt-1 max-w-[640px] text-sm text-mute">
                You pay for what the work uses: the AI model&apos;s calls, plus {num(billing.costs.metered.videoFee)} credits per video for rendering and
                storage, plus narration when it is on. So the model you pick sets the price, for 2D and 3D alike. These are typical amounts, in
                credits; the video counts on the packs are the average across these models, narrated.
              </p>
              <ModelTable billing={billing} />
            </section>

            <section className="mt-10 max-w-[560px]">
              <h2 className="text-lg font-medium">Everything else</h2>
              <dl className="mt-3 divide-y divide-line rounded-2xl border border-line bg-panel text-sm">
                {[
                  ["Change by chat, per scene rewritten", `~${num(billing.costs.change.perScene)}`] as const,
                  ["Small change by chat (music, colours)", num(billing.costs.change.min)] as const,
                  ...(billing.costs.narration
                    ? [[`Narration, ${billing.costs.seconds} s video`, `+${num(billing.costs.narration)}`] as const]
                    : []),
                ].map(([label, credits]) => (
                  <div key={label} className="flex justify-between gap-4 px-4 py-2.5">
                    <dt className="text-mute">{label}</dt>
                    <dd className="shrink-0 tabular-nums">{credits}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2 text-xs leading-relaxed text-dim">
                When work starts we set aside up to {billing.costs.metered.holdFactor}× its typical cost (or your whole balance, if that is less but
                covers the typical cost, so any model can start); when it finishes you&apos;re charged only what it
                used and the rest comes straight back. A video or change that fails is refunded in full. A chat change over{" "}
                {num(billing.costs.change.askAbove)} credits asks before it runs. Standard exports are included; questions in chat are free.
                First-purchase guarantee: if your first purchase isn&apos;t for you,{" "}
                <a href="mailto:aryanthakore24@gmail.com" className="underline underline-offset-2">
                  email us
                </a>{" "}
                within 7 days and we refund it in full, as long as you&apos;ve used fewer than half of its credits. Later purchases are not refunded:
                see the{" "}
                <Link href="/refunds" className="underline underline-offset-2">
                  refund policy
                </Link>
                .
              </p>
            </section>
          </>
        )}

        {billing && <ApiKeys />}
      </main>
      {back && (
        <CheckoutResult
          back={back}
          products={billing?.products ?? []}
          onClose={() => setBack(null)}
          onCredited={() => void reload()}
          onRetry={(sku) => {
            setBack(null);
            void checkout(sku);
          }}
        />
      )}
    </div>
  );
}
