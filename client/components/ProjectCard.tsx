"use client";

import Link from "next/link";
import { useState } from "react";
import { Trash2 } from "lucide-react";

import { api, assetUrl, thumbnailUrl } from "@/lib/api";
import { hostOf, timeAgo } from "@/lib/format";
import type { ProjectSummary, Stage } from "@/lib/types";
import { Badge, cn } from "@/components/ui";

export const STAGE_LABEL: Record<Stage, { label: string; tone: "neutral" | "accent" | "ok" | "warn" | "bad" }> = {
  created: { label: "Queued", tone: "neutral" },
  ingesting: { label: "Analyzing", tone: "accent" },
  profile: { label: "Review brand", tone: "warn" },
  brief: { label: "Confirm brief", tone: "warn" },
  directing: { label: "Directing", tone: "accent" },
  storyboard: { label: "Review storyboard", tone: "warn" },
  preview: { label: "Storyboard ready", tone: "warn" },
  coding: { label: "Building", tone: "accent" },
  verifying: { label: "Checking", tone: "accent" },
  ready: { label: "Ready", tone: "ok" },
  rendering: { label: "Rendering", tone: "accent" },
  error: { label: "Needs attention", tone: "bad" },
};

export function ProjectCard({
  project,
  onDeleted,
}: {
  project: ProjectSummary;
  onDeleted: () => void;
}) {
  const [thumbFailed, setThumbFailed] = useState(false);
  const stage = STAGE_LABEL[project.stage];
  const working = ["created", "ingesting", "directing", "coding", "verifying"].includes(project.stage);
  const vertical = project.aspect === "9:16";

  return (
    <div className="group relative rise">
      <Link
        href={`/p/${project.id}`}
        className="block overflow-hidden rounded-xl border border-line bg-panel transition-colors duration-150 hover:border-line-hi hover:bg-raised"
      >
        <div className="relative aspect-video overflow-hidden bg-raised">
          {project.hasThumbnail && !thumbFailed ? (
            <>
              {vertical && (
                // a vertical video sits on a blurred copy of itself
                // eslint-disable-next-line @next/next/no-img-element
                <img src={thumbnailUrl(project.id, project.version)} alt="" aria-hidden loading="lazy" className="absolute inset-0 size-full scale-125 object-cover opacity-50 blur-2xl" />
              )}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={thumbnailUrl(project.id, project.version)}
                alt=""
                loading="lazy"
                decoding="async"
                className={`relative size-full transition-transform duration-500 group-hover:scale-[1.03] ${vertical ? "object-contain" : "object-cover"}`}
                onError={() => setThumbFailed(true)}
              />
            </>
          ) : (
            <div className="grid size-full place-items-center bg-[radial-gradient(70%_80%_at_50%_0%,rgba(139,123,255,0.16),transparent)]">
              {project.logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={assetUrl(project.id, project.logo)} alt="" loading="lazy" decoding="async" className="max-h-12 max-w-[40%] object-contain opacity-90" />
              ) : (
                <span className="text-3xl font-semibold text-dim">{project.title.slice(0, 1).toUpperCase()}</span>
              )}
            </div>
          )}
          <div className="absolute left-3 top-3">
            <Badge tone={stage.tone}>
              {working && <span className="pulse-ring size-1.5 rounded-full bg-accent" />}
              {stage.label}
            </Badge>
          </div>
        </div>
        <div className="p-4">
          <div className="truncate font-medium">{project.title}</div>
          <div className="mt-0.5 flex items-center justify-between text-xs text-dim">
            <span className="truncate">{hostOf(project.url)}</span>
            <span className="shrink-0">{timeAgo(project.updatedAt)}</span>
          </div>
        </div>
      </Link>
      {/* a free preview stays until it is paid for */}
      {!project.unpaidPreview && (
        <button
          aria-label={`Delete ${project.title}`}
          onClick={async (e) => {
            e.preventDefault();
            if (!confirm(`Delete “${project.title}”? This cannot be undone.`)) return;
            try {
              await api.deleteProject(project.id);
              onDeleted();
            } catch (err) {
              alert(err instanceof Error ? err.message : String(err));
            }
          }}
          className={cn(
            "absolute right-3 top-3 grid size-8 place-items-center rounded-lg bg-black/60 text-mute opacity-0 backdrop-blur transition-opacity hover:text-bad focus-visible:opacity-100 group-hover:opacity-100 cursor-pointer"
          )}
        >
          <Trash2 className="size-4" />
        </button>
      )}
    </div>
  );
}
