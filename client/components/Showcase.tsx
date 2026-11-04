"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronLeft, ChevronRight, Play, X } from "lucide-react";

import { Skeleton, cn } from "@/components/ui";
import { api, showcasePosterUrl, showcaseVideoUrl, type ShowcaseItem } from "@/lib/api";
/** The showcase lists 2D and 3D films only. */
type Mode = ShowcaseItem["mode"];

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const shape = (i: ShowcaseItem) => (i.height > i.width * 1.2 ? "9:16" : i.width > i.height * 1.2 ? "16:9" : "1:1");

/**
 * One example: its poster, then the film itself, silent and looping, while
 * most of the card is on screen or while it's hovered or focused, so only the
 * cards in view load and play. Nothing plays by itself for a visitor who asks
 * for reduced motion or saves data; hovering still previews it.
 */
function Card({ item, index, onOpen, className }: { item: ShowcaseItem; index: number; onOpen: () => void; className?: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [hover, setHover] = useState(false);
  const [inView, setInView] = useState(false);
  // the video is added the first time the card plays and kept, so scrolling back resumes it without a refetch
  const [added, setAdded] = useState(false);
  // shown once it has a frame: until then the poster stays
  const [playing, setPlaying] = useState(false);
  const live = hover || inView;
  if (live && !added) setAdded(true);
  const portraitish = shape(item) !== "16:9";

  useEffect(() => {
    const el = ref.current;
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    if (!el || saveData || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const io = new IntersectionObserver(([e]) => setInView((e?.intersectionRatio ?? 0) >= 0.6), { threshold: 0.6 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (live) v.play().catch(() => undefined);
    else v.pause();
  }, [live]);

  return (
    <button
      ref={ref}
      onClick={onOpen}
      onPointerEnter={(e) => e.pointerType === "mouse" && setHover(true)}
      onPointerLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
      className={cn("rise group block w-full cursor-pointer text-left outline-none", className)}
    >
      <div className="relative aspect-video overflow-hidden rounded-xl bg-black shadow-[0_18px_40px_-22px_rgba(0,0,0,0.7)] ring-1 ring-white/10 transition-transform duration-300 group-hover:-translate-y-1 group-focus-visible:ring-2 group-focus-visible:ring-accent">
        {portraitish && (
          // a vertical or square video sits on a blurred copy of itself
          <img src={showcasePosterUrl(item)} alt="" aria-hidden loading="lazy" className="absolute inset-0 size-full scale-125 object-cover opacity-50 blur-2xl" />
        )}
        <img
          src={showcasePosterUrl(item)}
          alt=""
          loading="lazy"
          className={cn("absolute inset-0 size-full", portraitish ? "object-contain" : "object-cover")}
        />
        {added && (
          <video
            ref={video}
            src={showcaseVideoUrl(item)}
            muted
            loop
            playsInline
            preload="none"
            onPlaying={() => setPlaying(true)}
            className={cn(
              "absolute inset-0 size-full transition-opacity duration-300",
              portraitish ? "object-contain" : "object-cover",
              live && playing ? "opacity-100" : "opacity-0"
            )}
          />
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-black/70 to-transparent px-3 pb-2.5 pt-8">
          <span className="text-sm font-medium text-white">{item.title}</span>
          <span className="font-mono text-[11px] text-white/70">
            {shape(item)} · {clock(item.seconds)}
          </span>
        </div>
        <span className="absolute left-1/2 top-1/2 flex size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-black opacity-0 shadow-lg transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
          <Play className="ml-0.5 size-4 fill-current" />
        </span>
      </div>
    </button>
  );
}

/** Full-size player with sound; arrows step through the list. */
function Player({ items, index, onIndex, onClose }: { items: ShowcaseItem[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const item = items[index]!;
  const step = (d: number) => onIndex((index + d + items.length) % items.length);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && ref.current?.close()}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") step(1);
        if (e.key === "ArrowLeft") step(-1);
      }}
      className="m-auto max-h-none max-w-none bg-transparent p-0 backdrop:bg-black/80 backdrop:backdrop-blur-sm"
    >
      <div className="flex w-[min(92vw,1200px)] flex-col items-center gap-3">
        <video
          key={item.id}
          src={showcaseVideoUrl(item)}
          poster={showcasePosterUrl(item)}
          autoPlay
          controls
          playsInline
          className="max-h-[78vh] w-auto max-w-full rounded-xl bg-black shadow-2xl"
          style={{ aspectRatio: `${item.width} / ${item.height}` }}
        />
        <div className="flex w-full items-center justify-between gap-3 text-white">
          <button onClick={() => step(-1)} aria-label="Previous" className="cursor-pointer rounded-full p-2 hover:bg-white/10">
            <ChevronLeft className="size-5" />
          </button>
          <div className="text-center">
            <div className="text-sm font-medium">{item.title}</div>
            <div className="font-mono text-xs text-white/60">
              {index + 1} / {items.length} · {item.mode.toUpperCase()} · {clock(item.seconds)}
            </div>
          </div>
          <div className="flex items-center">
            <button onClick={() => step(1)} aria-label="Next" className="cursor-pointer rounded-full p-2 hover:bg-white/10">
              <ChevronRight className="size-5" />
            </button>
            <button onClick={() => ref.current?.close()} aria-label="Close" className="cursor-pointer rounded-full p-2 hover:bg-white/10">
              <X className="size-5" />
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );
}

/** How many examples the home page shows before "Show all". */
export const HOME_COUNT = 12;

/**
 * Examples in a style, a page at a time: the first page on mount (and on a
 * style change), the next when `loadMore` is called. Pages already loaded
 * for a style are kept, so switching back is instant.
 */
export function useShowcasePages(mode: Mode, pageSize: number) {
  const [pages, setPages] = useState<Partial<Record<Mode, { items: ShowcaseItem[]; total: number; hasMore: boolean }>>>({});
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  // requests in flight, per style: a style switch mid-request must not block the new style's first page
  const busy = useRef(new Set<Mode>());
  const current = pages[mode];

  const load = useCallback(
    async (offset: number) => {
      if (busy.current.has(mode)) return;
      busy.current.add(mode);
      setLoading(true);
      try {
        const page = await api.showcasePage(mode, offset, pageSize);
        setPages((all) => {
          const before = offset === 0 ? [] : (all[mode]?.items ?? []);
          return { ...all, [mode]: { items: [...before, ...page.items], total: page.total, hasMore: page.hasMore } };
        });
        setFailed(false);
      } catch {
        setFailed(true);
      } finally {
        busy.current.delete(mode);
        setLoading(busy.current.size > 0);
      }
    },
    [mode, pageSize]
  );

  useEffect(() => {
    if (!current) void Promise.resolve().then(() => load(0));
  }, [current, load]);

  const loadMore = useCallback(() => {
    if (current?.hasMore && !failed) void load(current.items.length);
  }, [current, failed, load]);

  return { items: current?.items ?? null, total: current?.total ?? 0, hasMore: !!current?.hasMore, loading, failed, loadMore };
}

/**
 * The grid of example cards, with the full player. Shared by the home page and
 * /examples; with `row` (the home page), a phone gets one row to swipe through
 * instead of a long stack.
 */
export function ShowcaseGrid({ items, mode, skeletons = 6, row = false }: { items: ShowcaseItem[] | null; mode: Mode; skeletons?: number; row?: boolean }) {
  const [open, setOpen] = useState<number | null>(null);
  const cell = row ? "w-[78%] shrink-0 snap-start sm:w-auto" : undefined;
  return (
    <>
      <div
        key={mode}
        className={
          row
            ? "-mx-5 flex scroll-px-5 snap-x snap-mandatory gap-4 overflow-x-auto px-5 pb-2 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-x-5 sm:gap-y-6 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-3"
            : "grid gap-x-5 gap-y-6 sm:grid-cols-2 lg:grid-cols-3"
        }
      >
        {items
          ? items.map((item, i) => <Card key={item.id} item={item} index={i % HOME_COUNT} onOpen={() => setOpen(i)} className={cell} />)
          : Array.from({ length: skeletons }, (_, i) => <Skeleton key={i} className={cn("aspect-video rounded-xl", cell)} />)}
      </div>
      {items && open !== null && items[open] && <Player items={items} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />}
    </>
  );
}

/** Recently made videos in the chosen style, under the prompt on the home page: the first 12 in the order set in the Accessboard CMS, then "Show all". */
export function Showcase({ mode }: { mode: Mode }) {
  const { items, total } = useShowcasePages(mode, HOME_COUNT);
  if (items && items.length === 0) return null;

  return (
    <section aria-labelledby="showcase-title" className="relative z-10 mx-auto w-full max-w-[1120px] px-5 pb-24">
      <div className="mb-5 flex items-baseline justify-between gap-4">
        <h2 id="showcase-title" className="text-lg font-medium tracking-tight text-[color:var(--hero-fg)]">
          Recently made {mode === "3d" ? "in 3D" : "in 2D"}
        </h2>
        {items && total > 0 && (
          <Link
            href={`/examples?mode=${mode}`}
            className="group inline-flex items-center gap-1.5 text-sm font-medium text-[color:var(--hero-fg-mute)] hover:text-[color:var(--hero-fg)]"
          >
            Show all <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        )}
      </div>
      <ShowcaseGrid items={items} mode={mode} row />
      {items && total > items.length && (
        <div className="mt-10 text-center">
          <Link
            href={`/examples?mode=${mode}`}
            className="inline-flex items-center gap-2 rounded-lg bg-panel/95 px-5 py-2.5 text-sm font-medium text-fg shadow-[0_10px_30px_-10px_rgba(0,0,0,0.5)] transition-transform hover:-translate-y-0.5"
          >
            Show all {total} {mode === "3d" ? "3D" : "2D"} videos <ArrowRight className="size-4" />
          </Link>
        </div>
      )}
    </section>
  );
}
