"use client";

import { useEffect, useState } from "react";

import { cn } from "@/components/ui";

/**
 * Launch pricing: the price people pay now beside the regular price it goes
 * up to when the offer ends, the saving, and how long is left. Shared by the
 * home page and the Credits page.
 */

export const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: cents % 100 ? 2 : 0 })}`;

/** "Dec 31, 2026" */
const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

type Left = { days: number; hours: number; minutes: number; seconds: number };

/** Time left until the end of `iso` (UTC), ticking each second on the viewer's clock once mounted (null before, so the server render has no clock). */
const useTimeLeft = (iso: string): Left | null => {
  const [left, setLeft] = useState<Left | null>(null);
  useEffect(() => {
    const tick = () => {
      const s = Math.max(0, Math.floor((Date.parse(`${iso}T23:59:59Z`) - Date.now()) / 1000));
      setLeft({ days: Math.floor(s / 86_400), hours: Math.floor(s / 3_600) % 24, minutes: Math.floor(s / 60) % 60, seconds: s % 60 });
    };
    tick();
    const timer = window.setInterval(tick, 1_000);
    return () => window.clearInterval(timer);
  }, [iso]);
  return left;
};

/** The saving, in whole percent. */
export const savePercent = (price: number, regular?: number) => (regular && regular > price ? Math.round((1 - price / regular) * 100) : 0);

/** A price with its regular price struck through and the saving, while launch pricing lasts. */
export function PriceTag({
  cents,
  regularCents,
  unit,
  size = "lg",
  note,
}: {
  cents: number;
  regularCents?: number;
  /** "/mo", "/yr" */
  unit?: string;
  size?: "lg" | "md";
  /** A line under the price ("$24/mo, billed yearly"). */
  note?: React.ReactNode;
}) {
  const save = savePercent(cents, regularCents);
  return (
    <div>
      {save > 0 && (
        <div className="flex items-center gap-2">
          <span
            className={cn("font-medium text-mute line-through decoration-bad decoration-2", size === "lg" ? "text-lg" : "text-base")}
            aria-label={`Regular price ${usd(regularCents!)}`}
          >
            {usd(regularCents!)}
            {unit}
          </span>
          <span className="whitespace-nowrap rounded-md bg-[#18904c] px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">Save {save}%</span>
        </div>
      )}
      <div className={cn("font-medium tracking-tight text-fg", size === "lg" ? "mt-1 text-3xl" : "mt-0.5 text-2xl")}>
        {usd(cents)}
        {unit && <span className="text-sm font-normal text-mute">{unit}</span>}
      </div>
      {note && <div className="mt-1 text-xs text-dim">{note}</div>}
    </div>
  );
}

/** One number of the countdown. */
const Tile = ({ value, label }: { value: number; label: string }) => (
  <div className="flex w-[54px] flex-col items-center rounded-lg bg-white/[0.07] py-1.5 ring-1 ring-white/10">
    <span className="font-mono text-[20px] font-semibold leading-none text-white tabular-nums">{String(value).padStart(2, "0")}</span>
    <span className="mt-1 text-[9px] font-medium uppercase tracking-[0.14em] text-white/50">{label}</span>
  </div>
);

/**
 * The launch-pricing strip over the prices: what it is, when it ends, and a
 * live countdown. A solid near-black panel with an accent edge, the same in
 * both themes.
 */
export function OfferBanner({ offer, save, className }: { offer: { name: string; endsAt: string }; /** The biggest saving on offer, in percent. */ save?: number; className?: string }) {
  const left = useTimeLeft(offer.endsAt);
  return (
    <div
      className={cn(
        "relative mx-auto flex max-w-[860px] flex-col items-center gap-4 overflow-hidden rounded-2xl bg-[#101014] px-5 py-4 text-white shadow-[0_24px_60px_-28px_rgba(0,0,0,0.8)] ring-1 ring-white/10 sm:flex-row sm:justify-between sm:px-6",
        className
      )}
    >
      {/* the accent edge */}
      <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-accent" />
      <div className="text-center sm:text-left">
        <div className="flex flex-col items-center gap-1.5 sm:flex-row sm:gap-2.5">
          <span className="whitespace-nowrap rounded-full bg-accent/20 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-[#c3c8ff] ring-1 ring-accent/50">
            Limited time
          </span>
          <span className="text-[16px] font-semibold tracking-tight">
            {offer.name}
            {save ? <span className="text-[#c3c8ff]"> · up to {save}% off</span> : null}
          </span>
        </div>
        <p className="mt-1.5 text-sm text-white/65">For early users. Prices go up to the regular price after {day(offer.endsAt)}.</p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5" role="timer" aria-label={`Launch prices end ${day(offer.endsAt)}`}>
        {left ? (
          <>
            <Tile value={left.days} label="days" />
            <Tile value={left.hours} label="hrs" />
            <Tile value={left.minutes} label="min" />
            <Tile value={left.seconds} label="sec" />
          </>
        ) : (
          <span className="text-sm font-medium text-white/80">Ends {day(offer.endsAt)}</span>
        )}
      </div>
    </div>
  );
}

/** Under a yearly price: what it comes to a month, and the two months free. */
export const YearlyNote = ({ cents }: { cents: number }) => (
  <span className="flex flex-wrap items-center gap-1.5">
    {usd(Math.round(cents / 12))}/mo, billed yearly
    <span className="rounded bg-[#18904c] px-1.5 py-px text-[10.5px] font-semibold text-white">2 months free</span>
  </span>
);

/** Monthly / Yearly switch; yearly gets two months free, said in a tag over it. */
export function PeriodToggle({ value, onChange }: { value: "month" | "year"; onChange: (v: "month" | "year") => void; onHero?: boolean }) {
  return (
    <div className="relative inline-flex pt-3">
      <div role="radiogroup" aria-label="Billing period" className="inline-flex rounded-full bg-panel p-1 text-sm shadow-[0_8px_24px_-14px_rgba(0,0,0,0.5)] ring-1 ring-line">
        {(["month", "year"] as const).map((i) => (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={value === i}
            onClick={() => onChange(i)}
            className={cn("relative cursor-pointer rounded-full px-5 py-1.5 font-medium transition-colors", value === i ? "bg-fg text-bg" : "text-mute hover:text-fg")}
          >
            {i === "month" ? "Monthly" : "Yearly"}
            {i === "year" && (
              <span className="pointer-events-none absolute -right-5 -top-4 whitespace-nowrap rounded-full bg-[#18904c] px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-white shadow-[0_4px_12px_-4px_rgba(24,144,76,0.7)] ring-2 ring-bg">
                2 months free
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
