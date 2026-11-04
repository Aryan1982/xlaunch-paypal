import Link from "next/link";
import { ChevronDown } from "lucide-react";

import { CopyLine } from "@/components/home/CopyLine";
import { HomePlans } from "@/components/home/HomePlans";
import { typicalVideo, type Pricing } from "@/lib/pricing";
import { FeaturedOn } from "@/components/home/Badges";
import { APP_URL, FAQ, MCP_COMMAND, SITE_NAME, STEPS } from "@/lib/site";
import { USE_CASES } from "@/lib/use-cases";

/**
 * The home page below the example videos: how it works, pricing, questions,
 * Claude/MCP, footer. Server-rendered, so crawlers and answer engines read it
 * as plain HTML. Nothing goes between the prompt and the videos.
 */

const num = (n: number) => n.toLocaleString("en-US");

const Heading = ({ id, kicker, title }: { id: string; kicker: string; title: string }) => (
  <div className="mb-8 text-center">
    <div className="text-xs font-medium uppercase tracking-[0.14em] text-[color:var(--hero-fg-mute)]">{kicker}</div>
    <h2 id={id} className="mt-2 text-balance text-[28px] font-medium tracking-tight text-[color:var(--hero-fg)] sm:text-[34px]">
      {title}
    </h2>
  </div>
);

function HowItWorks() {
  return (
    <section aria-labelledby="how" className="mx-auto w-full max-w-[1120px] px-5 py-20">
      <Heading id="how" kicker="How it works" title="From your website to a launch video" />
      <ol className="grid gap-4 sm:grid-cols-3">
        {STEPS.map((step, i) => (
          <li key={step.title} className="rounded-2xl bg-panel/95 p-6 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.6)] ring-1 ring-line">
            <span className="grid size-8 place-items-center rounded-full bg-accent/15 text-sm font-medium text-accent tabular-nums">{i + 1}</span>
            <h3 className="mt-4 text-[17px] font-medium text-fg">{step.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-mute">{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** What sets a video's price: the cost by model and how credits are charged. Under "See all plans and packs", and on /pricing. */
export function CostByModel({ pricing }: { pricing: Pricing }) {
  const typical = typicalVideo(pricing.costs);
  return (
    <>
      {(pricing.costs.lineup?.length ?? 0) > 1 && (
        <div className="mx-auto mt-14 max-w-[680px]">
          <h3 className="text-center text-[20px] font-medium tracking-tight text-[color:var(--hero-fg)]">The model sets the price</h3>
          <p className="mt-1.5 text-center text-sm text-[color:var(--hero-fg-mute)]">Typical credits for a {pricing.costs.seconds}-second 2D video.</p>
          <ul className="mt-5 divide-y divide-line overflow-hidden rounded-2xl bg-panel/95 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.6)] ring-1 ring-line">
            {pricing.costs.lineup!.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-4 px-5 py-3.5 text-sm">
                <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 font-medium text-fg">
                  {m.label}
                  {!m.available && <span className="whitespace-nowrap rounded-full bg-panel-hi px-2 py-0.5 text-[11px] font-normal text-mute">Coming soon</span>}
                </span>
                <span className="shrink-0 whitespace-nowrap tabular-nums text-mute">~{num(m.video)} credits</span>
              </li>
            ))}
            {!!pricing.costs.narration && (
              <li className="flex items-center justify-between gap-4 px-5 py-3.5 text-sm">
                <span className="min-w-0 text-mute">Narration (voice-over and captions), any model</span>
                <span className="shrink-0 whitespace-nowrap tabular-nums text-mute">+{num(pricing.costs.narration)} credits</span>
              </li>
            )}
          </ul>
        </div>
      )}
      <p className="mx-auto mt-8 max-w-[680px] text-center text-sm leading-relaxed text-[color:var(--hero-fg-mute)]">
        Yearly plans get two months free. You pay for what each video uses, so the AI model sets the price: a narrated
        {" "}{pricing.costs.seconds}-second video is typically {num(typical.cheapest)} to {num(typical.dearest)} credits depending on the
        model, about {num(typical.average)} on average. Video counts on plans and packs are that average. A video that fails gets its
        credits back automatically.
      </p>
    </>
  );
}

function Prices({ pricing }: { pricing: Pricing }) {
  return (
    <section aria-labelledby="pricing" className="mx-auto w-full max-w-[1120px] px-5 py-20">
      <Heading id="pricing" kicker="Pricing" title="Pay for the videos you make" />
      <HomePlans pricing={pricing} more={<CostByModel pricing={pricing} />} />
    </section>
  );
}

function Claude() {
  return (
    <section aria-labelledby="claude" className="mx-auto w-full max-w-[1120px] px-5 py-20">
      <div className="mx-auto max-w-[760px] rounded-2xl bg-panel/95 p-5 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.6)] ring-1 ring-line sm:p-9">
        <div className="text-xs font-medium uppercase tracking-[0.14em] text-mute">For Claude and AI agents</div>
        <h2 id="claude" className="mt-2 text-[24px] font-medium tracking-tight text-fg">Let Claude make your launch video</h2>
        <p className="mt-2 text-sm leading-relaxed text-mute">
          {SITE_NAME} is an MCP server: connect it to Claude and ask for a video in plain words. Claude creates, revises and
          exports it for you, paid from your credits. When it needs more, it hands you a PayPal link to approve: an agent can start a
          purchase, only you can pay.
        </p>
        <p className="mt-5 text-sm font-medium text-fg">In claude.ai or the Claude app</p>
        <p className="mt-1 text-sm leading-relaxed text-mute">
          Settings, then Connectors, then Add custom connector. Paste this address and sign in to {SITE_NAME}:
        </p>
        <div className="mt-3">
          <CopyLine text={`${APP_URL}/api/mcp`} />
        </div>
        <p className="mt-5 text-sm font-medium text-fg">In Claude Code</p>
        <div className="mt-2">
          <CopyLine text={MCP_COMMAND} />
        </div>
        <p className="mt-3 text-xs leading-relaxed text-dim">
          Make your key on the{" "}
          <Link href="/billing" className="py-1.5 underline underline-offset-2 hover:text-fg">
            Credits page
          </Link>
          .{" "}
          <Link href="/for/developer-tools" className="py-1.5 underline underline-offset-2 hover:text-fg">
            Launch videos for developer tools
          </Link>
        </p>
      </div>
    </section>
  );
}

function Questions() {
  return (
    <section aria-labelledby="faq" className="mx-auto w-full max-w-[760px] px-5 py-20">
      <Heading id="faq" kicker="Questions" title="Frequently asked" />
      <div className="divide-y divide-line overflow-hidden rounded-2xl bg-panel/95 ring-1 ring-line">
        {FAQ.map((item) => (
          <details key={item.q} className="group px-6 py-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-medium text-fg">
              <h3>{item.q}</h3>
              <ChevronDown className="size-4 shrink-0 text-mute transition-transform group-open:rotate-180" />
            </summary>
            <p className="mt-3 text-sm leading-relaxed text-mute">{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

/** The site footer: the home page, /examples and the use-case pages. Links to every use case, so search engines find them. */
export function Footer() {
  // a 40px tap height on phones; text height from sm up, where a pointer is precise
  const link = "inline-flex min-h-10 items-center hover:text-[color:var(--hero-fg)] sm:min-h-0";
  return (
    <footer className="mx-auto w-full max-w-[1120px] border-t border-white/10 px-5 py-8 text-sm text-[color:var(--hero-fg-mute)]">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <img src="/logo/icon.png" alt="" width={20} height={20} className="size-5 rounded-[24%]" />
          {SITE_NAME} · Launch videos from your website · Built by{" "}
          <a href="https://www.aryanthakor.com/hire/ai-agent-developer" className="underline-offset-4 hover:underline">
            Aryan Thakor
          </a>
        </div>
        <nav className="-my-2 flex flex-wrap gap-x-5 sm:my-0 sm:gap-y-2" aria-label="Footer">
          <Link href="/examples" className={link}>
            Examples
          </Link>
          <Link href="/pricing" className={link}>
            Pricing
          </Link>
          <Link href="/alternatives" className={link}>
            Alternatives
          </Link>
          <Link href="/#faq" className={link}>
            FAQ
          </Link>
          <Link href="/terms" className={link}>
            Terms
          </Link>
          <Link href="/refunds" className={link}>
            Refunds
          </Link>
          <Link href="/privacy" className={link}>
            Privacy
          </Link>
        </nav>
      </div>
      <nav className="mt-3 flex flex-wrap gap-x-5 sm:mt-5 sm:gap-y-2" aria-label="Use cases">
        <Link href="/for" className={link}>
          Use cases:
        </Link>
        {USE_CASES.map((u) => (
          <Link key={u.slug} href={`/for/${u.slug}`} className={link}>
            {u.name}
          </Link>
        ))}
      </nav>
      <FeaturedOn />
    </footer>
  );
}

export function HomeSections({ pricing }: { pricing: Pricing | null }) {
  return (
    <div className="relative z-10">
      <HowItWorks />
      {pricing && <Prices pricing={pricing} />}
      <Questions />
      <Claude />
      <Footer />
    </div>
  );
}
