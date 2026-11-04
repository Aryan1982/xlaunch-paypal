import type { Metadata } from "next";

import { HomePlans } from "@/components/home/HomePlans";
import { MakeVideoLink, PageShell } from "@/components/home/PageShell";
import { CostByModel } from "@/components/home/Sections";
import { getPricing } from "@/lib/pricing";

// LaunchPricing's `usd` lives in a client module: a server page formats its own
const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: cents % 100 ? 2 : 0 })}`;

const TITLE = "Pricing";
const DESCRIPTION =
  "XLaunch pricing: a free preview with no card needed, then $15 for one launch video or a monthly plan. Pay only for the videos you make; first purchase refundable within 7 days.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/pricing" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/pricing", type: "website" },
  twitter: { title: TITLE, description: DESCRIPTION },
};

/** Every plan and pack, public: signing in is asked for only when buying. */
export default async function PricingPage() {
  const pricing = await getPricing();
  const one = pricing?.products.find((p) => p.sku === "pack_one");
  const plans = pricing?.products.filter((p) => p.kind === "subscription" && p.interval === "month").map((p) => p.priceCents) ?? [];
  return (
    <PageShell>
      <section className="mx-auto w-full max-w-[1120px] px-5 pb-20 pt-14">
        <div className="mb-10 text-center">
          <h1 className="text-balance text-[32px] font-medium tracking-tight text-[color:var(--hero-fg)] sm:text-[40px]">Pricing</h1>
          <p className="mx-auto mt-3 max-w-[560px] text-pretty text-[15px] leading-relaxed text-[color:var(--hero-fg-mute)]">
            Free preview · no card needed. Pay only to finish a video
            {one ? `: ${usd(one.priceCents)} for one` : ""}
            {plans.length ? `, or a plan from ${usd(Math.min(...plans))} a month` : ""}.
          </p>
          <div className="mt-6">
            <MakeVideoLink>Generate free preview</MakeVideoLink>
          </div>
        </div>
        {pricing ? (
          <HomePlans pricing={pricing} open more={<CostByModel pricing={pricing} />} />
        ) : (
          <p className="text-center text-sm text-[color:var(--hero-fg-mute)]">Prices didn&rsquo;t load. Try again in a minute.</p>
        )}
      </section>
    </PageShell>
  );
}
