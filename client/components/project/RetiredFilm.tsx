"use client";

import { Download } from "lucide-react";

import { downloadUrl } from "@/lib/api";
import type { Project } from "@/lib/types";
import { Button } from "@/components/ui";

/**
 * A film from the retired scene studio (mode "2d"/"3d"): nothing can play its
 * source, change it or export it again. An MP4 exported before still plays
 * and downloads.
 */
export function RetiredFilm({ project }: { project: Project }) {
  const exported = project.render.state === "done";
  return (
    <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col justify-center gap-4 px-6 py-8">
      <div className="rounded-xl border border-line bg-panel px-4 py-3 text-[13px] text-mute" role="note">
        This film was made with the older scene studio, which has been retired.{" "}
        {exported ? "Its exported video is still available; make a new film to change it." : "It was never exported, so there is no video to play; make a new film instead."}
      </div>
      {exported && (
        <>
          <video
            src={downloadUrl(project.id)}
            controls
            preload="metadata"
            className={project.options.aspect === "9:16" ? "mx-auto max-h-[70vh] rounded-xl bg-black" : "w-full rounded-xl bg-black"}
          />
          <a href={downloadUrl(project.id)} className="self-start">
            <Button size="sm" variant="primary">
              <Download className="size-3.5" /> Download MP4
            </Button>
          </a>
        </>
      )}
    </div>
  );
}
