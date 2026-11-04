"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, Film, Lock, ShieldCheck, Sparkles } from "lucide-react";

import { gaBeginCheckout } from "@/components/CheckoutResult";
import { savePercent } from "@/components/LaunchPricing";
import { ModelMenu, useEffort, useModel } from "@/components/ModelPicker";
import { Button, cn, ErrorBanner, Skeleton } from "@/components/ui";
import { api, type Billing, type BillingProduct } from "@/lib/api";
import { track } from "@/lib/funnel";
import type { Project } from "@/lib/types";

const num = (n: number) => n.toLocaleString("en-US");

/** The cheapest product of a kind (a plan: of an interval) that brings the balance up to `need` credits (or the biggest, when none does). */
const coverWith = (products: BillingProduct[], need: number, kind: BillingProduct["kind"], interval: "month" | "year" = "month"): BillingProduct | null => {
  const of = products.filter((p) => p.kind === kind && (p.kind === "pack" || p.interval === interval));
  return [...of].sort((a, b) => a.priceCents - b.priceCents).find((p) => p.credits >= need) ?? of.sort((a, b) => b.credits - a.credits)[0] ?? null;
};

const dollars = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;

/** A line of what paying brings; `highlight` sets it apart, with the line it adds (the upgrade worth naming). */
export type Included = { title: string; detail?: string; highlight?: string };

/**
 * The way past a free preview: one price for this video (the cheapest pack
 * that covers it, plans quieter under it), the first-purchase guarantee, and
 * what it includes. The model and its credits sit under Advanced. Pays with
 * credits on hand, else through checkout. A bar keeps the price in view on a
 * phone. `included`: what the whole video brings, a line each.
 */
export function Paywall({ project, included }: { project: Project; included: Included[] }) {
  const [billing, setBilling] = useState<Billing | null>(null);
  // only models with a price can be shown a price for
  const priced = new Set((billing?.costs.lineup ?? []).filter((m) => m.available).map((m) => m.id));
  // a preview is finished with the model that made it (config.motion.previewModel, the project's model, or the model
  // behind a retired setup id: claude-sonnet-5-5+full → claude-sonnet-5-5), unless the user picks another; else the default
  const [model, setModel, offered] = useModel(project.options.model?.split("+")[0]);
  const models = billing ? offered.filter((m) => priced.has(m.id)) : offered;
  const effort = useEffort(model, project.options.effort);
  const [pick, setPick] = useState<"pack" | "month" | "year">("pack");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seen = useRef(false);

  useEffect(() => {
    api.billing().then(setBilling).catch(() => undefined);
    if (!seen.current) {
      seen.current = true;
      track("paywall_viewed", { projectId: project.id });
    }
  }, [project.id]);

  // what making the whole video costs with the chosen model (typical; only what it uses is charged)
  const estimate = useMemo(() => {
    const lineup = billing?.costs.lineup ?? [];
    const m = lineup.find((x) => x.id === model) ?? lineup.find((x) => x.id === project.options.model);
    if (!m) return null;
    return (project.options.film3d ? m.film3d : m.video) + (project.options.narration ? (billing?.costs.narration ?? 0) : 0);
  }, [billing, model, project.options.model, project.options.film3d, project.options.narration]);
  const balance = billing?.balance.total ?? 0;
  const short = estimate === null ? 0 : Math.max(0, estimate - balance);
  const enough = estimate !== null && short === 0;
  const products = billing?.products ?? [];
  // what credits buy, said in videos like this one (credits are the detail, under Advanced)
  const videosLike = (credits: number) => {
    if (estimate === null || estimate <= 0) return `${num(credits)} credits`;
    const n = Math.floor(credits / estimate);
    return n >= 1 ? `About ${num(n)} video${n === 1 ? "" : "s"} like this` : `${num(credits)} credits`;
  };
  // what a pack covers: this video, and what is left after it
  const covers = (credits: number) => {
    if (estimate === null || balance + credits < estimate) return `${num(credits)} credits · never expire`;
    const more = Math.floor((balance + credits - estimate) / estimate);
    if (more >= 1) return `This video, plus about ${num(more)} more like it`;
    return balance + credits - estimate >= (billing?.costs.change.min ?? 0) ? "This video, plus small changes" : "This video";
  };
  // the ways to pay, each the cheapest of its kind that covers this video: a pack (the One video pack for a typical film), a monthly plan, the same plan yearly
  const pack = coverWith(products, short, "pack");
  const monthly = coverWith(products, short, "subscription", "month");
  const yearly = monthly?.kind === "subscription" ? (products.find((p) => p.kind === "subscription" && p.interval === "year" && p.tier === monthly.tier) ?? null) : null;
  const options = [
    pack && { key: "pack" as const, product: pack, label: "Pay once", unit: undefined, tag: null, detail: covers(pack.credits) },
    monthly && {
      key: "month" as const,
      product: monthly,
      label: "Monthly plan",
      unit: "/mo",
      // the launch price against the regular one, while the offer lasts
      tag: savePercent(monthly.priceCents, monthly.regularPriceCents) > 0 ? `Save ${savePercent(monthly.priceCents, monthly.regularPriceCents)}%` : null,
      detail: `${videosLike(monthly.credits)} a month`,
    },
    yearly && monthly && {
      key: "year" as const,
      product: yearly,
      label: "Yearly plan",
      unit: "/yr",
      // what a year costs against twelve months of the monthly plan
      tag: Math.round(12 - yearly.priceCents / monthly.priceCents) > 0 ? `${Math.round(12 - yearly.priceCents / monthly.priceCents)} months free` : null,
      detail: `${videosLike(yearly.credits)}, up front`,
    },
  ].filter((o): o is NonNullable<typeof o> => !!o);
  // the option picked, or the first there is (a pick that isn't on offer falls back)
  const current = options.find((o) => o.key === pick) ?? options[0] ?? null;
  const chosen = current?.product ?? null;
  // what paying costs, in dollars: what a first-time buyer understands (credits are the detail)
  const price = chosen ? `${dollars(chosen.priceCents)}${chosen.kind === "subscription" ? (chosen.interval === "year" ? "/yr" : "/mo") : ""}` : null;
  const modelLabel = models.find((m) => m.id === model)?.label.replace(/^Claude\s+/, "") ?? "this model";

  const render = async () => {
    setError(null);
    setBusy("render");
    try {
      await api.buildPreview(project.id, { model: model ?? undefined, effort: effort.shown ? (effort.effort ?? undefined) : undefined });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };
  const pay = async (product: BillingProduct) => {
    setError(null);
    setBusy(product.sku);
    gaBeginCheckout(product.sku, products);
    try {
      // the model chosen here is the one the film is made with after paying
      window.location.assign((await api.checkout(product.sku, project.id, model ?? undefined)).url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  return (
    <>
      {/* on a phone the panel is at the end of the page: a bar keeps the price in view and pays with the option picked there (until billing loads, it leads to the panel); a failure shows on the bar too */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-panel px-4 py-3 shadow-[0_-12px_30px_-18px_rgba(0,0,0,0.5)] lg:hidden">
        {error && (
          <div className="mb-3">
            <ErrorBanner message={error} />
          </div>
        )}
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-xs text-dim">{!enough && price ? "Finish this video for" : "Finish this video"}</div>
            <div className="truncate font-semibold tabular-nums text-fg">{!enough && price ? price : estimate === null ? "…" : `about ${num(estimate)} credits`}</div>
          </div>
          <Button
            variant="accent"
            className="h-11"
            loading={busy !== null}
            disabled={busy !== null}
            onClick={() => (enough ? void render() : chosen ? void pay(chosen) : document.getElementById("render")?.scrollIntoView({ behavior: "smooth" }))}
          >
            {chosen && !enough ? <Sparkles className="size-4" /> : <Film className="size-4" />} Finish
          </Button>
        </div>
      </div>

      <aside id="render" className="scroll-mt-4 pb-24 lg:sticky lg:top-6 lg:self-start lg:pb-0">
        {/* a gradient rim in the accent, and its glow: the panel is the page's one call to action */}
        <div className="rounded-2xl bg-gradient-to-b from-accent/70 via-accent/25 to-line p-px shadow-[0_30px_80px_-40px_var(--accent)]">
          <div className="rounded-[15px] bg-panel p-5">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-accent">
              <Sparkles className="size-3" /> Like the plan?
            </span>
            <h2 className="mt-2.5 text-xl font-semibold leading-snug tracking-tight text-fg">Finish the whole film</h2>

          {!billing ? (
            <Skeleton className="mt-5 h-24" />
          ) : enough ? (
            <>
              <p className="mt-5 text-sm text-mute">You have {num(balance)} credits: enough for this video.</p>
              <Button variant="accent" className="mt-3 h-11 w-full" loading={busy === "render"} disabled={busy !== null} onClick={() => void render()}>
                <Film className="size-4" /> Finish my film
              </Button>
            </>
          ) : (
            <>
              {/* one way to pay up front, the one that covers this video; plans for more videos under it, quieter */}
              <div className="mt-5" role="radiogroup" aria-label="How to pay">
                {options.map((o, i) => {
                  const on = current?.key === o.key;
                  const plan = o.key !== "pack";
                  return (
                    <Fragment key={o.key}>
                      {plan && i > 0 && options[i - 1].key === "pack" && <p className="mb-1.5 mt-3 text-xs text-dim">Or a plan, for more videos</p>}
                      <button
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => setPick(o.key)}
                        className={cn(
                          "flex w-full cursor-pointer items-center gap-3 rounded-xl border text-left transition-colors",
                          plan ? "mt-1.5 px-3 py-2" : "px-3.5 py-3",
                          on ? "border-accent bg-accent/[0.06]" : "border-line hover:border-line-hi"
                        )}
                      >
                        <span className={cn("grid size-4 shrink-0 place-items-center rounded-full border", on ? "border-accent" : "border-line-hi")}>
                          {on && <span className="size-2 rounded-full bg-accent" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className={cn("flex items-center gap-2 font-medium", plan ? "text-[13px] text-mute" : "text-sm text-fg")}>
                            {o.label}
                            {o.tag && <span className="rounded-md bg-ok/15 px-1.5 py-0.5 text-[11px] font-medium text-ok">{o.tag}</span>}
                          </span>
                          <span className={cn("block text-xs", plan ? "text-dim" : "text-mute")}>{o.detail}</span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className={cn("block font-semibold tabular-nums", plan ? "text-sm text-mute" : "text-[15px] text-fg")}>
                            {dollars(o.product.priceCents)}
                            {o.unit && <span className="text-xs font-normal text-mute">{o.unit}</span>}
                          </span>
                          {o.product.regularPriceCents && o.product.regularPriceCents > o.product.priceCents && (
                            <span className="block text-[11px] tabular-nums text-dim line-through">{dollars(o.product.regularPriceCents)}</span>
                          )}
                        </span>
                      </button>
                    </Fragment>
                  );
                })}
              </div>
              <Button variant="accent" className="mt-3 h-11 w-full" loading={busy === chosen?.sku} disabled={busy !== null || !chosen} onClick={() => chosen && void pay(chosen)}>
                <Sparkles className="size-4" /> {price ? `Pay with PayPal · ${price}` : "Finish my film"}
              </Button>
              <p className="mt-2 text-center text-xs text-dim">
                Your film is finished as soon as the payment goes through.{chosen?.kind === "subscription" ? " Cancel any time." : ""}
              </p>
              {/* the launch discount, only when the option picked has one (the One video pack never does) */}
              {billing.offer && chosen && savePercent(chosen.priceCents, chosen.regularPriceCents) > 0 && (
                <p className="mt-2 text-center text-xs font-medium text-ok">
                  Launch price, {savePercent(chosen.priceCents, chosen.regularPriceCents)}% off until{" "}
                  {new Date(`${billing.offer.endsAt}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}
                </p>
              )}
              <p className="mt-3 flex gap-2 rounded-lg bg-ok/[0.07] px-3 py-2.5 text-xs leading-relaxed text-mute">
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-ok" />
                <span>
                  <span className="font-medium text-fg">First-purchase guarantee:</span> if your first purchase isn&apos;t for you,{" "}
                  <a href="mailto:aryanthakore24@gmail.com" className="underline underline-offset-2 hover:text-fg">
                    email us
                  </a>{" "}
                  within 7 days and we refund it in full, as long as you&apos;ve used fewer than half of its credits.
                </span>
              </p>
              <p className="mt-2 flex items-center justify-center gap-1.5 text-[11px] text-dim">
                <Lock className="size-3" /> Secure checkout by PayPal · PayPal balance, Venmo or card
              </p>
              <Link href="/billing" className="mt-1 block text-center text-xs text-mute underline-offset-2 hover:text-fg hover:underline">
                See all credit packs
              </Link>
            </>
          )}
          {error && (
            <div className="mt-3">
              <ErrorBanner message={error} />
            </div>
          )}

          {/* the model and the credits: there to change, out of the way of a first purchase */}
          <details className="group mt-4 rounded-xl border border-line">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-xs text-mute hover:text-fg [&::-webkit-details-marker]:hidden">
              <span>Advanced</span>
              <span className="flex min-w-0 items-center gap-1.5 text-dim">
                <span className="truncate">{modelLabel}</span>
                <ChevronDown className="size-3.5 shrink-0 transition-transform group-open:rotate-180" />
              </span>
            </summary>
            <div className="border-t border-line p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="shrink-0 text-xs text-mute">Model</span>
                <div className="-mr-1.5 min-w-0">
                  <ModelMenu value={model} models={models} onChange={setModel} effort={effort} up={false} />
                </div>
              </div>
              <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-line pt-2.5">
                <span className="shrink-0 text-xs text-mute">This video, about</span>
                <span className="whitespace-nowrap text-lg font-semibold tabular-nums tracking-tight text-fg">
                  {estimate !== null ? num(estimate) : billing ? "—" : <Skeleton className="inline-block h-5 w-14 align-middle" />}
                  <span className="ml-1 text-xs font-normal text-mute">credits</span>
                </span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-dim">
                You&apos;re charged only what finishing the film uses. If it fails, the credits come back automatically.
              </p>
            </div>
          </details>

            {/* what paying brings, under the way to pay: the button stays in view on a short window */}
            <ul className="mt-5 space-y-2.5 border-t border-line pt-4 text-sm">
              {included.map((item, i) =>
                item.highlight ? (
                  // the upgrade worth naming: set apart by a rule and the accent, in the list's own type
                  <li key={item.title} style={{ animationDelay: `${i * 50}ms` }} className="rise -ml-3 flex gap-2.5 border-l-2 border-accent pl-2.5">
                    <span className="mt-px grid size-5 shrink-0 place-items-center rounded-full bg-accent/15 text-accent">
                      <Check className="size-3" strokeWidth={3} />
                    </span>
                    <span className="min-w-0">
                      <span className="block font-medium text-fg">{item.title}</span>
                      <span className="block text-xs font-medium text-accent">{item.highlight}</span>
                      {item.detail && <span className="block text-xs leading-snug text-mute">{item.detail}</span>}
                    </span>
                  </li>
                ) : (
                  <li key={item.title} style={{ animationDelay: `${i * 50}ms` }} className="rise flex gap-2.5">
                    <span className="mt-px grid size-5 shrink-0 place-items-center rounded-full bg-ok/15 text-ok">
                      <Check className="size-3" strokeWidth={3} />
                    </span>
                    <span className="min-w-0">
                      <span className="block font-medium text-fg">{item.title}</span>
                      {item.detail && <span className="block text-xs leading-snug text-mute">{item.detail}</span>}
                    </span>
                  </li>
                )
              )}
            </ul>
          </div>
        </div>
      </aside>
    </>
  );
}

/** What a model is called, without its maker: "Claude Opus 5.5" → "Opus 5.5". */
export const shortModelLabel = (label: string) => label.replace(/^Claude\s+/, "");
