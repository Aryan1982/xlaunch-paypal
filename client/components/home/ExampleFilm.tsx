"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Play, X } from "lucide-react";

import { cn } from "@/components/ui";

/**
 * Films on the home page: the XLaunch intro (a static file in public/intro)
 * first, then finished films made with XLaunch, shipped with the server
 * (server/assets/motion-showcase/films.json). The first is the hero's
 * looping film; all of them are "Watch" chips under the composer. Playing
 * one costs nothing and needs no sign-in.
 */
export type ExampleFilm = {
  id: string;
  /** The chip's label. */
  site: string;
  title: string;
  note: string;
  /** Its own files and caption (the intro); without them, a showcase film from the API. */
  src?: string;
  poster?: string;
  caption?: string;
};

export const EXAMPLE_FILMS: ExampleFilm[] = [
  {
    id: "intro",
    site: "XLaunch in 30 s",
    title: "XLaunch",
    note: "What XLaunch does, in 30 seconds",
    src: "/intro/xlaunch-intro.mp4",
    poster: "/intro/xlaunch-intro.jpg",
    caption: "XLaunch in 30 seconds",
  },
  { id: "cal", site: "cal.com", title: "Cal.com", note: "With sound effects" },
  { id: "resend-narrated", site: "resend.com", title: "Resend", note: "Narrated, with captions" },
];

const fileOf = (film: ExampleFilm, kind: "mp4" | "jpg") =>
  (kind === "mp4" ? film.src : film.poster) ?? `/api/showcase-motion/${film.id}.${kind}`;

/** "Made with XLaunch from cal.com", or the film's own caption. */
const captionOf = (film: ExampleFilm) => film.caption ?? `${film.title}, made with XLaunch from ${film.site}`;

/**
 * One film beside the composer, silent and looping: the poster first, the
 * video only once the frame is on screen, and never by itself for a visitor
 * who asks for reduced motion or saves data. Clicking opens it with sound.
 */
export function HeroFilm({ film, onOpen, className }: { film: ExampleFilm; onOpen: () => void; className?: string }) {
  const box = useRef<HTMLButtonElement>(null);
  const [load, setLoad] = useState(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const el = box.current;
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    if (!el || saveData || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const io = new IntersectionObserver(([e]) => {
      if (e?.isIntersecting) {
        setLoad(true);
        io.disconnect();
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <figure className={cn("rise w-full", className)}>
      <button
        ref={box}
        type="button"
        onClick={onOpen}
        aria-label={`Play ${film.caption ?? `the ${film.title} launch video`} with sound`}
        className="group relative block aspect-video w-full cursor-pointer overflow-hidden rounded-2xl bg-black shadow-[0_30px_80px_-30px_rgba(0,0,0,0.75)] ring-1 ring-white/10 outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <img src={fileOf(film, "jpg")} alt="" width={1280} height={720} className="absolute inset-0 size-full object-cover" />
        {load && (
          <video
            src={fileOf(film, "mp4")}
            muted
            loop
            autoPlay
            playsInline
            preload="none"
            onPlaying={() => setPlaying(true)}
            className={cn("absolute inset-0 size-full object-cover transition-opacity duration-300", playing ? "opacity-100" : "opacity-0")}
          />
        )}
        <span className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium text-white backdrop-blur transition-colors group-hover:bg-black/75">
          <Play className="size-3 fill-current" /> Watch with sound
        </span>
      </button>
      <figcaption className="mt-3 text-center text-sm text-[color:var(--hero-fg-mute)] lg:text-left">
        {film.caption ? (
          <span className="text-[color:var(--hero-fg)]">{film.caption}</span>
        ) : (
          <>
            Made with XLaunch from <span className="text-[color:var(--hero-fg)]">{film.site}</span>
          </>
        )}
      </figcaption>
    </figure>
  );
}

/** A film full size, with sound and controls, and the way to start your own. */
export function FilmDialog({ film, onClose, onMake }: { film: ExampleFilm; onClose: () => void; onMake: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  // closing puts focus back where it was (the chip): the composer takes it once the dialog has closed
  const make = useRef(false);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      onClose={() => {
        onClose();
        if (make.current) onMake();
      }}
      onClick={(e) => e.target === ref.current && ref.current?.close()}
      aria-label={captionOf(film)}
      className="m-auto max-h-none max-w-none bg-transparent p-0 backdrop:bg-black/80 backdrop:backdrop-blur-sm"
    >
      <div className="flex w-[min(92vw,1100px)] flex-col items-center gap-4">
        <video
          key={film.id}
          src={fileOf(film, "mp4")}
          poster={fileOf(film, "jpg")}
          autoPlay
          controls
          playsInline
          className="aspect-video max-h-[74vh] w-auto max-w-full rounded-xl bg-black shadow-2xl"
        />
        <div className="flex w-full flex-wrap items-center justify-between gap-3 text-white">
          <div className="min-w-0">
            <div className="text-sm font-medium">{captionOf(film)}</div>
            <div className="text-xs text-white/60">{film.note}</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                make.current = true;
                ref.current?.close();
              }}
              className="flex h-10 cursor-pointer items-center gap-2 rounded-lg bg-white px-4 text-sm font-medium text-black transition-all hover:bg-white/85 active:scale-[0.98]"
            >
              Make one for your site <ArrowRight className="size-4" />
            </button>
            <button type="button" onClick={() => ref.current?.close()} aria-label="Close" className="cursor-pointer rounded-full p-2 hover:bg-white/10">
              <X className="size-5" />
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );
}
