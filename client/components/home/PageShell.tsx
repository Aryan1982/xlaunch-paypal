import type { ReactNode } from "react";
import Link from "next/link";

import { AccountMenu } from "@/components/AccountMenu";
import { Scene } from "@/components/Scene";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Footer } from "@/components/home/Sections";
import { SITE_NAME } from "@/lib/site";

/** A public content page (the use-case pages): the home page's backdrop and header, the content, the site footer. */
export function PageShell({ children }: { children: ReactNode }) {
  return (
    <div data-mode="2d" className="relative min-h-screen overflow-x-hidden">
      <Scene />
      <header className="relative z-20 flex items-center justify-between px-5 pt-4">
        <Link href="/" className="flex items-center gap-2 text-sm font-medium text-[color:var(--hero-fg)]">
          <img src="/logo/icon.png" alt="" width={28} height={28} className="size-7 shrink-0 rounded-[24%]" />
          <span>{SITE_NAME}</span>
        </Link>
        <div className="flex items-center gap-2">
          <ThemeToggle onHero />
          <AccountMenu onHero />
        </div>
      </header>
      <div className="relative z-10">
        {children}
        <Footer />
      </div>
    </div>
  );
}

/** The primary call to action on a content page: to the home page's prompt. */
export function MakeVideoLink({ children = "Make your launch video" }: { children?: ReactNode }) {
  return (
    <Link
      href="/"
      className="inline-flex h-11 items-center rounded-xl bg-fg px-5 text-sm font-medium text-bg shadow-[0_10px_30px_-10px_rgba(0,0,0,0.5)] transition-all hover:bg-fg/85 active:scale-[0.98]"
    >
      {children}
    </Link>
  );
}
