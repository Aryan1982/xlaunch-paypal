"use client";

import Link from "next/link";
import { useEffect } from "react";
import { ArrowRight } from "lucide-react";

import type { PublicShare } from "@/lib/api";
import { trackVisit } from "@/lib/funnel";
import { Logo } from "@/components/Brand";
import { ThemeToggle } from "@/components/ThemeToggle";
import { VideoPlayer } from "@/components/VideoPlayer";
import { cn } from "@/components/ui";

/** Where a viewer goes to make their own: the home page's prompt, counted as coming from a share link. */
const MAKE_YOUR_OWN = "/?utm_source=share";

function MakeYourOwn() {
  return (
    <section className="rounded-2xl border border-line bg-panel p-5 sm:flex sm:items-center sm:justify-between sm:gap-6">
      <div>
        <h2 className="text-[17px] font-semibold tracking-tight text-fg">Make a launch video for your product</h2>
        <p className="mt-1 text-sm text-mute">Paste your website and get a preview like this one. Free preview · no card needed.</p>
      </div>
      <Link
        href={MAKE_YOUR_OWN}
        className="mt-4 inline-flex h-11 shrink-0 items-center gap-2 rounded-xl bg-accent px-5 text-sm font-medium text-white shadow-[0_12px_30px_-12px_var(--accent)] transition-all hover:bg-accent-hi active:scale-[0.98] sm:mt-0"
      >
        Make your launch video <ArrowRight className="size-4" />
      </Link>
    </section>
  );
}

/** A film opened by its share link: the film (a free preview plays only its opening), what is still to come, and how to make one. */
export function SharedFilm({ token, share }: { token: string; share: PublicShare | null }) {
  // the share link is where this visit came from
  useEffect(() => trackVisit({ utm: "share" }), []);

  const preview = share?.preview ?? null;
  const shown = preview ? Math.round(preview.cut) : 0;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between px-5">
        <Logo />
        <ThemeToggle />
      </header>

      <main className="mx-auto w-full max-w-[880px] flex-1 space-y-6 px-5 pb-16 pt-4">
        {!share ? (
          <section className="rounded-2xl border border-line bg-panel p-6">
            <h1 className="text-[24px] font-semibold tracking-tight text-fg">This link doesn&apos;t work</h1>
            <p className="mt-2 text-[15px] text-mute">Its owner may have turned it off. Ask them for a new one.</p>
          </section>
        ) : (
          <>
            <div>
              {preview && (
                <span className="inline-flex items-center rounded-full bg-accent/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-accent">
                  Preview · {shown} of {share.seconds} seconds
                </span>
              )}
              <h1 className="mt-3 text-balance text-[26px] font-semibold leading-tight tracking-tight text-fg sm:text-[28px]">Launch video for {share.title}</h1>
              <p className="mt-1.5 text-[15px] text-mute">
                {share.host && <>{share.host} · </>}Made with XLaunch
              </p>
            </div>

            {share.ready ? (
              <section className="overflow-hidden rounded-2xl border border-line bg-panel">
                <div className={cn("relative bg-black", share.aspect === "9:16" && "mx-auto aspect-[9/16] max-h-[70vh]")}>
                  <VideoPlayer shareToken={token} version={share.version} autoPlay loop until={preview?.cut} aspect={share.aspect} />
                </div>
                {preview && (
                  <p className="border-t border-line px-4 py-3 text-[13px] text-mute">
                    The first {shown} seconds are built. The other {share.seconds - shown} are planned and get made when the film is finished.
                  </p>
                )}
              </section>
            ) : (
              <section className="rounded-2xl border border-line bg-panel p-6 text-[15px] text-mute">This video isn&apos;t ready yet. Open the link again in a few minutes.</section>
            )}
          </>
        )}

        <MakeYourOwn />
      </main>
    </div>
  );
}
