"use client";

import { Loader2 } from "lucide-react";

import type { Project } from "@/lib/types";
import { clock, useNow } from "@/lib/use-now";
import { VideoPlayer } from "@/components/VideoPlayer";
import { cn } from "@/components/ui";

/** What is happening to a film that is on screen: a change being made, or the change that failed. */
function ChangeBar({ project }: { project: Project }) {
  const failed = project.stage === "error";
  const running = !!project.jobStartedAt && !project.jobEndedAt;
  const now = useNow(running);
  if (failed)
    return (
      <div className={cn("rise rounded-xl border px-4 py-3 text-[13px]", project.stopped ? "border-line bg-panel text-mute" : "border-bad/25 bg-bad/5 text-bad")}>
        {project.error ?? "The change didn’t finish."} This is the film as it was; ask again in the chat.
      </div>
    );
  return (
    <div className="rise flex items-center gap-3 rounded-xl border border-line-hi bg-panel px-4 py-3 text-[13px]" role="status">
      <Loader2 className="size-4 shrink-0 animate-spin text-accent" />
      <span className="min-w-0 flex-1 truncate text-fg">{project.activity ?? "Changing the film"}</span>
      <span className="shrink-0 text-dim">This version plays until the new one is ready</span>
      {project.jobStartedAt && <span className="shrink-0 font-mono tabular-nums text-dim">{clock(now - project.jobStartedAt)}</span>}
    </div>
  );
}

/**
 * A film, playing live from its agent's published code (the same code an
 * export renders). While a change is made, the current version keeps playing
 * under a bar saying so.
 */
export function MotionView({ project }: { project: Project }) {
  const ready = project.stage === "ready" || project.stage === "rendering";
  return (
    <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col justify-center gap-4 px-6 py-8">
      {!ready && <ChangeBar project={project} />}
      {/* each version in a fresh frame: a film's @remotion/media audio breaks when a second bundle loads into the same page (Mediabunny loaded twice) */}
      <VideoPlayer key={project.version} projectId={project.id} version={project.version} autoPlay loop aspect={project.options.aspect} />
    </div>
  );
}
