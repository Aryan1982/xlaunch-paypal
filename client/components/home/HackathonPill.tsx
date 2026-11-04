import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { cn } from "@/components/ui";

/**
 * Above the headline: what this edition is (the PayPal AI Hackathon build,
 * on the PayPal sandbox) and where its payments live (/billing: PayPal's
 * buttons, the credit activity).
 */
export function HackathonPill({ className }: { className?: string }) {
  return (
    <div className={cn("flex", className)}>
      <Link
        href="/billing"
        className="group inline-flex items-center gap-2 rounded-full border border-black/10 bg-white/60 py-1 pl-1 pr-3 text-[12.5px] text-[color:var(--hero-fg)] backdrop-blur-md transition-[background-color,border-color,transform] duration-200 hover:border-black/20 hover:bg-white/75 active:scale-[0.98] dark:border-white/15 dark:bg-black/25 dark:hover:border-white/25 dark:hover:bg-black/35"
      >
        <span className="rounded-full bg-[#ffc439] px-2 py-0.5 text-[11px] font-semibold text-[#003087]">PayPal</span>
        <span>
          Pay with PayPal, or let your AI agent buy it
          <span className="text-[color:var(--hero-fg-mute)]"> · sandbox demo</span>
        </span>
        <ArrowRight className="size-3.5 opacity-70 transition-transform duration-200 group-hover:translate-x-0.5" />
      </Link>
    </div>
  );
}
