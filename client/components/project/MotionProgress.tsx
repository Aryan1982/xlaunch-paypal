"use client";

import { Check, Clock, Loader2, RotateCcw, Volume2, VolumeX } from "lucide-react";
import { useEffect, useState } from "react";

import { api, motionShowcaseUrl, type MotionShowcaseItem } from "@/lib/api";
import type { Project } from "@/lib/types";
import { clock, useNow } from "@/lib/use-now";
import { Button, cn } from "@/components/ui";
import { FoundCard, StoryboardCard } from "@/components/project/MotionNotes";

/** A motion film is made by one agent session: it reads the links, plans, builds and reviews; the film shows once it passes the check. */
const STEPS = [
  { label: "Research", detail: "Reading your site", stages: ["created", "ingesting"] },
  { label: "Plan", detail: "Writing the story", stages: ["profile", "brief", "directing", "storyboard"] },
  { label: "Build & review", detail: "Animating, checking frames", stages: ["coding", "verifying"] },
] as const;

const stepOf = (stage: Project["stage"]): number => STEPS.findIndex((s) => (s.stages as readonly string[]).includes(stage));

/** Films made with XLaunch, one after another, while this one is made. */
function Showcase() {
  const [items, setItems] = useState<MotionShowcaseItem[]>([]);
  const [index, setIndex] = useState(0);
  const [muted, setMuted] = useState(true);
  // how far the playing film is, for its tab's bar
  const [played, setPlayed] = useState(0);

  useEffect(() => {
    let live = true;
    api
      .motionShowcase()
      .then((list) => live && setItems(list))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const item = items[index];
  if (!item) return <div className="aspect-video w-full rounded-2xl bg-panel" aria-hidden />;
  return (
    <section aria-label="Films made with XLaunch" className="rise">
      <div className="mb-2.5 flex items-center justify-between text-[13px]">
        <span className="font-medium text-fg">While you wait</span>
        <span className="text-dim">Films made with XLaunch</span>
      </div>
      <div className="relative overflow-hidden rounded-2xl bg-black shadow-[0_24px_60px_-30px_rgba(0,0,0,0.8)] ring-1 ring-white/10">
        <video
          key={item.id}
          src={motionShowcaseUrl(item, "mp4")}
          poster={motionShowcaseUrl(item, "jpg")}
          autoPlay
          muted={muted}
          playsInline
          loop={items.length === 1}
          onTimeUpdate={(e) => setPlayed(e.currentTarget.duration ? e.currentTarget.currentTime / e.currentTarget.duration : 0)}
          onEnded={() => {
            setPlayed(0);
            setIndex((i) => (i + 1) % items.length);
          }}
          className="aspect-video w-full object-cover"
        />
        <button
          onClick={() => setMuted((m) => !m)}
          aria-label={muted ? "Turn sound on" : "Turn sound off"}
          className="absolute bottom-3 right-3 grid size-8 cursor-pointer place-items-center rounded-full bg-black/50 text-white backdrop-blur transition-colors hover:bg-black/70"
        >
          {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
        </button>
      </div>
      {items.length > 1 && (
        <div className="mt-2.5 flex gap-2" role="tablist">
          {items.map((film, i) => (
            <button
              key={film.id}
              role="tab"
              aria-selected={i === index}
              onClick={() => {
                setPlayed(0);
                setIndex(i);
              }}
              className={cn(
                "relative min-w-0 flex-1 cursor-pointer overflow-hidden rounded-xl border px-3 py-2.5 text-left transition-colors",
                i === index ? "border-accent/40 bg-panel" : "border-line bg-panel/50 hover:bg-panel"
              )}
            >
              <div className={cn("truncate text-[13px] font-medium", i === index ? "text-fg" : "text-mute")}>{film.title}</div>
              <div className="truncate text-[12px] text-dim">{film.note}</div>
              {i === index && <span className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-accent" style={{ transform: `scaleX(${played})` }} />}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * A motion film being made: where it is, films made with XLaunch to watch
 * meanwhile, and what has been worked out so far (what was found, the
 * narration, the storyboard). The film itself shows once it is done.
 */
export function MotionProgress({ project }: { project: Project }) {
  const failed = project.stage === "error";
  const agent = project.motionAgent;
  const running = !!project.jobStartedAt && !project.jobEndedAt;
  const now = useNow(running);
  const elapsed = project.jobStartedAt ? (project.jobEndedAt ?? now) - project.jobStartedAt : 0;
  const current = failed ? -1 : stepOf(project.stage);
  const queued = project.queuedChanges?.length ?? 0;
  const name = agent?.found?.siteName ?? project.title;
  const [busy, setBusy] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  const retry = async () => {
    setBusy(true);
    setRetryError(null);
    try {
      await api.retry(project.id);
    } catch (e) {
      setRetryError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-8">
      {/* the header on a soft wash of the accent, as on the preview page */}
      <header className="relative overflow-hidden rounded-2xl border border-line bg-panel p-6">
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-32 size-80 rounded-full bg-accent/15 blur-3xl" />
        <div className="relative">
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-semibold tracking-tight text-fg">{failed ? "That didn’t finish" : `Making your film${name ? ` for ${name}` : ""}`}</h1>
              <p className="mt-1.5 text-[14px] text-mute">
                {failed
                  ? "Your progress is saved. You can pick up where it stopped."
                  : project.options.freePreview && project.version === 0
                    ? "It shows here when it’s done."
                    : "It shows here when it’s done. Ask for changes in the chat any time."}
              </p>
            </div>
            {!failed && (
              <div className="flex shrink-0 items-center gap-2 rounded-full border border-line bg-panel-hi px-3 py-1.5 text-[12px] text-mute">
                <Clock className="size-3.5" />
                <span className="font-mono font-medium tabular-nums text-fg">{clock(elapsed)}</span>
                <span className="text-dim">usually 5–8 min</span>
              </div>
            )}
          </div>

          <ol className="mt-6 grid grid-cols-3" aria-label="Progress">
            {STEPS.map((step, i) => {
              const done = current > i;
              const active = current === i;
              return (
                <li key={step.label} className="relative min-w-0 pr-3">
                  {/* the track to the next step */}
                  {i < STEPS.length - 1 && <span aria-hidden className={cn("absolute left-8 right-0 top-3.5 h-px", done ? "bg-ok/60" : "bg-line-hi")} />}
                  <span
                    className={cn(
                      "relative grid size-7 place-items-center rounded-full text-[12px] font-semibold",
                      done ? "bg-ok/15 text-ok" : active ? "bg-accent text-white shadow-[0_0_0_4px_color-mix(in_srgb,var(--accent)_20%,transparent)]" : "bg-panel-hi text-dim ring-1 ring-line-hi"
                    )}
                  >
                    {done ? <Check className="size-3.5" strokeWidth={3} /> : active ? <Loader2 className="size-3.5 animate-spin" /> : i + 1}
                  </span>
                  <div className={cn("mt-2.5 text-[13px] font-medium", active ? "text-fg" : done ? "text-mute" : "text-dim")}>{step.label}</div>
                  <div className="mt-0.5 truncate text-[12px] text-dim">{active && project.activity ? project.activity : step.detail}</div>
                </li>
              );
            })}
          </ol>
        </div>
      </header>

      {queued > 0 && !failed && (
        <div className="rise rounded-xl border border-line-hi bg-panel px-4 py-3 text-[13px] text-mute">
          {queued === 1 ? "1 change" : `${queued} changes`} queued: {queued === 1 ? "it’s" : "they’re"} made as soon as the film is done.
        </div>
      )}

      {failed && (
        <div className="space-y-3">
          <p
            className={cn(
              "whitespace-pre-wrap break-words rounded-xl border px-4 py-3 text-sm",
              project.stopped ? "border-line bg-panel text-mute" : "border-bad/25 bg-bad/5 text-bad"
            )}
          >
            {project.error}
          </p>
          {retryError && <p className="text-sm text-bad">{retryError}</p>}
          <Button variant="primary" loading={busy} onClick={retry}>
            <RotateCcw className="size-4" /> {project.stopped ? "Run it again" : "Try again"}
          </Button>
        </div>
      )}

      {!failed && <Showcase />}

      {agent?.found && <FoundCard projectId={project.id} found={agent.found} />}

      {agent?.plan && <StoryboardCard plan={agent.plan} />}
    </div>
  );
}
