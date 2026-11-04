"use client";

import { useEffect, useState } from "react";
import { Check, Lock, PlayCircle } from "lucide-react";

import type { Project } from "@/lib/types";
import { api, motionShowcaseUrl, type MotionShowcaseItem } from "@/lib/api";
import { useModel } from "@/components/ModelPicker";
import { VideoPlayer } from "@/components/VideoPlayer";
import { FoundCard, IconTile, StoryboardCard } from "@/components/project/MotionNotes";
import { Paywall, shortModelLabel, type Included } from "@/components/project/Paywall";
import { cn } from "@/components/ui";

/** The film's timeline: what is built (the preview) and what is planned. */
function Timeline({ seconds, cut }: { seconds: number; cut: number }) {
  const built = Math.min(1, cut / seconds);
  // the cut may fall mid-second: labelled in whole seconds
  const at = Math.round(cut);
  return (
    <div className="border-t border-line px-4 py-3.5">
      <div className="relative h-2.5 overflow-hidden rounded-full bg-accent/10">
        <div className="absolute inset-y-0 left-0 rounded-full bg-ok" style={{ width: `${built * 100}%` }} />
        <div
          className="absolute inset-y-0 right-0"
          style={{ left: `${built * 100}%`, backgroundImage: "repeating-linear-gradient(135deg, color-mix(in srgb, var(--accent) 45%, transparent) 0 6px, transparent 6px 12px)" }}
        />
      </div>
      <div className="mt-2 flex justify-between gap-3 text-[12px]">
        <span className="flex items-center gap-1.5 font-medium text-ok">
          <Check className="size-3.5" strokeWidth={2.5} /> 0–{at} s built
        </span>
        <span className="flex items-center gap-1.5 font-medium text-accent">
          <Lock className="size-3.5" /> {at}–{seconds} s planned, made when you finish
        </span>
      </div>
    </div>
  );
}

/** A finished film made with XLaunch: what this one becomes. */
function FinishedExample() {
  const [film, setFilm] = useState<MotionShowcaseItem | null>(null);
  useEffect(() => {
    api
      .motionShowcase()
      .then((items) => setFilm(items[0] ?? null))
      .catch(() => undefined);
  }, []);
  if (!film) return null;
  return (
    <section className="rise overflow-hidden rounded-2xl border border-line bg-panel">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 text-sm">
        <span className="flex min-w-0 items-center gap-2.5 font-medium text-fg">
          <IconTile icon={PlayCircle} tone="ok" /> A finished film, made with XLaunch
        </span>
        <span className="shrink-0 whitespace-nowrap text-xs text-dim">
          {film.title} · {film.seconds} s
        </span>
      </div>
      <video src={motionShowcaseUrl(film, "mp4")} poster={motionShowcaseUrl(film, "jpg")} controls muted playsInline preload="metadata" className="aspect-video w-full bg-black" />
    </section>
  );
}

/**
 * A film agent's free preview, waiting to be paid for: its opening, built and
 * cut where the preview ends, a timeline of what is built and what is
 * planned, a finished film to show where this one goes, the storyboard of the
 * whole film (PLAN.md), and the paywall.
 */
export function FilmPreview({ project }: { project: Project }) {
  const agent = project.motionAgent;
  const name = agent?.found?.siteName ?? project.title;
  const seconds = project.options.length;
  // where the preview stops, recorded on the film (the server's preview length; previews made before it was recorded stopped at 10 s)
  const cut = agent?.cut ?? 10;
  // the cut may fall mid-second: shown in whole seconds
  const shown = Math.round(cut);
  const [, , models] = useModel(project.options.model);
  const strong = models.map((m) => shortModelLabel(m.label));
  const included: Included[] = [
    { title: `The whole ${seconds}-second film, built from this storyboard`, detail: `The first ${shown} seconds stay as you see them` },
    { title: "Access to stronger models", highlight: "Get better videos", detail: strong.length ? `${strong.join(" and ")} for this film and every change` : "Pick a stronger model for this film and every change" },
    ...(project.options.narration ? [{ title: "The whole narration voiced, with captions" }] : []),
    { title: "MP4 export, 16:9 or 9:16" },
    { title: "Change anything after, by chat" },
  ];

  return (
    <div className="mx-auto grid w-full max-w-[1180px] gap-6 px-5 py-8 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-6">
        {/* the header on a soft wash of the accent: the page opens on the user's film, not on a form */}
        <div className="relative overflow-hidden rounded-2xl border border-line bg-panel p-6">
          <div aria-hidden className="pointer-events-none absolute -right-24 -top-32 size-80 rounded-full bg-accent/20 blur-3xl" />
          <div aria-hidden className="pointer-events-none absolute -bottom-32 -left-16 size-64 rounded-full bg-ok/10 blur-3xl" />
          <div className="relative">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-accent">
              Free preview · {shown} of {seconds} seconds
            </span>
            <h1 className="mt-3 text-balance text-[28px] font-semibold leading-tight tracking-tight text-fg">Your launch film for {name} is ready to finish</h1>
            <p className="mt-2 max-w-[640px] text-[15px] leading-relaxed text-mute">
              The whole film is planned, and its opening is built. Watch how it opens and read the storyboard; finish it to get the other {seconds - shown} seconds.
            </p>
          </div>
        </div>

        <section className="overflow-hidden rounded-2xl border border-line bg-panel shadow-[0_24px_60px_-34px_var(--accent)] ring-1 ring-accent/20">
          <div className={cn("relative bg-black", project.options.aspect === "9:16" && "mx-auto aspect-[9/16] max-h-[70vh]")}>
            <VideoPlayer key={project.version} projectId={project.id} version={project.version} autoPlay loop until={cut} aspect={project.options.aspect ?? "16:9"} />
            <span className="pointer-events-none absolute left-3 top-3 rounded-md bg-black/60 px-2 py-1 text-[11px] font-medium text-white backdrop-blur">
              Preview · {shown} of {seconds} s
            </span>
          </div>
          <Timeline seconds={seconds} cut={cut} />
        </section>

        {agent?.plan && <StoryboardCard plan={agent.plan} />}

        <FinishedExample />

        {agent?.found && <FoundCard projectId={project.id} found={agent.found} />}
      </div>

      <Paywall project={project} included={included} />
    </div>
  );
}
