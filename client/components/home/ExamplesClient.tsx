"use client";

import { useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { AccountMenu } from "@/components/AccountMenu";
import { ModeToggle } from "@/components/ModeToggle";
import { Scene } from "@/components/Scene";
import { HOME_COUNT, ShowcaseGrid, useShowcasePages } from "@/components/Showcase";
import { Footer } from "@/components/home/Sections";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Spinner } from "@/components/ui";
import { setMode as rememberMode, useMode, type Mode } from "@/lib/use-mode";

/** Every example in a style, loaded a page at a time as the visitor scrolls; `children`: the page's text, under the films. */
export function ExamplesClient({ children }: { children?: ReactNode }) {
  const params = useSearchParams();
  const router = useRouter();
  const [stored] = useMode();
  const asked = params.get("mode");
  const mode: "2d" | "3d" = asked === "2d" || asked === "3d" ? asked : stored;
  const { items, hasMore, loading, failed, loadMore } = useShowcasePages(mode, HOME_COUNT);
  const sentinel = useRef<HTMLDivElement>(null);

  // the next page starts loading a screen before the end is reached
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && loadMore(), { rootMargin: "800px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loadMore, items?.length]);

  const choose = (next: Mode) => {
    rememberMode(next);
    router.replace(`/examples?mode=${next}`, { scroll: false });
  };

  return (
    <div data-mode={mode} className="relative min-h-screen overflow-x-hidden">
      <Scene />
      <header className="relative z-20 flex items-center justify-between px-5 pt-4">
        <Link href="/" className="group flex items-center gap-2 text-sm font-medium text-[color:var(--hero-fg)]">
          <ArrowLeft className="size-4 opacity-70 transition-transform group-hover:-translate-x-0.5" />
          <img src="/logo/icon.png" alt="" width={28} height={28} className="size-7 shrink-0 rounded-[24%]" />
          <span className="hidden sm:inline">XLaunch</span>
        </Link>
        <div className="absolute left-1/2 top-4 -translate-x-1/2">
          <ModeToggle mode={mode} onChange={choose} />
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle onHero />
          <AccountMenu onHero />
        </div>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-[1120px] px-5 pb-24 pt-16">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[32px] font-medium tracking-tight text-[color:var(--hero-fg)] sm:text-[40px]">Example launch videos</h1>
            <p className="mt-2 text-[15px] text-[color:var(--hero-fg-mute)]">
              {mode === "3d" ? "3D launch films" : "2D launch videos"} made with XLaunch from a website. They play as you scroll; open one to watch it with sound.
            </p>
          </div>
        </div>

        <ShowcaseGrid items={items} mode={mode} skeletons={HOME_COUNT} />
        {items && items.length === 0 && <p className="text-[color:var(--hero-fg-mute)]">No videos in this style yet.</p>}

        <div ref={sentinel} className="mt-12 flex justify-center">
          {loading && items ? (
            <Spinner className="size-5 text-[color:var(--hero-fg)]" />
          ) : hasMore ? (
            <button
              onClick={loadMore}
              className="cursor-pointer rounded-lg bg-panel/95 px-5 py-2.5 text-sm font-medium text-fg shadow-[0_10px_30px_-10px_rgba(0,0,0,0.5)]"
            >
              {failed ? "Couldn't load more. Try again" : "Load more"}
            </button>
          ) : null}
        </div>
        <div className="mt-6 text-center">
          <Link href="/" className="text-sm text-[color:var(--hero-fg-mute)] underline-offset-4 hover:text-[color:var(--hero-fg)] hover:underline">
            Make yours from your website
          </Link>
        </div>
        {children}
      </main>
      <div className="relative z-10">
        <Footer />
      </div>
    </div>
  );
}
