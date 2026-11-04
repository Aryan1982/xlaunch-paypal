"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  Brain,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleSlash,
  Clapperboard,
  Code,
  Eye,
  FileText,
  Globe,
  Images,
  Info,
  LoaderCircle,
  Mic,
  NotebookPen,
  PenLine,
  Search,
  ShieldCheck,
  Terminal,
  TriangleAlert,
  X,
  type LucideIcon,
} from "lucide-react";

import { reviewFrameUrl } from "@/lib/api";
import { segmentsOf, type FeedRow, type RunHeader, type Thought } from "@/lib/timeline";
import type { FeedFrame, FeedIcon, FeedItem, FeedStatus } from "@/lib/types";
import { clock } from "@/lib/use-now";
import { cn } from "@/components/ui";

/**
 * One run of the film agent in the chat, as a timeline: what it was asked to
 * do, its thinking (folded), each step with its state and time, the frames it
 * rendered to review, and how it ended. A finished run folds its older steps.
 */

const STEP_ICON: Record<FeedIcon, LucideIcon> = { web: Globe, search: Search, plan: NotebookPen, code: Code, look: Eye, file: FileText, run: Terminal };
const STATUS_TEXT: Record<FeedStatus, string> = { running: "in progress", done: "done", error: "failed", stopped: "stopped" };

/** A finished run with more blocks than this shows only its last TAIL until opened. */
const FOLD_OVER = 6;
const TAIL = 4;
/** Thumbnails in a stills row; past it the last cell says how many more. */
const THUMBS = 6;

/** The strong ease-out the timeline's disclosures open with. */
const EASE = "ease-[cubic-bezier(0.23,1,0.32,1)]";

export const frameAlt = (f: FeedFrame) => `Frame ${f.frame} at ${f.seconds.toFixed(1)} s`;

export function RunActivity({
  projectId,
  header,
  items,
  live,
  now,
  portrait,
  hideFinalError,
}: {
  projectId: string;
  header?: RunHeader;
  items: FeedItem[];
  /** The run is going on now: its running steps spin and the latest thinking shows a preview. */
  live: boolean;
  now: number;
  portrait: boolean;
  /** The run's closing error is the chat's error box already. */
  hideFinalError: boolean;
}) {
  // a run watched live stays open when it ends (no jump); one opened later starts folded
  const [expanded, setExpanded] = useState(live);
  const all = segmentsOf(items);
  const last = all.at(-1);
  const segments = hideFinalError && last?.type === "row" && last.item.kind === "error" ? all.slice(0, -1) : all;
  const foldable = !live && segments.length > FOLD_OVER;
  const hidden = foldable && !expanded ? segments.length - TAIL : 0;
  const shown = segments.slice(hidden);
  const done = items.find((i): i is Extract<FeedItem, { kind: "done" }> => i.kind === "done");
  const meta = [header?.meta, done && clock(done.ms)].filter(Boolean).join(" · ");

  return (
    <section aria-label={header?.label ?? "What the agent did"}>
      <ol className="relative space-y-1.5 before:pointer-events-none before:absolute before:inset-y-2.5 before:left-[9.5px] before:w-px before:bg-line">
        {header && (
          <Line icon={header.mode === "change" ? PenLine : Clapperboard} iconClass="text-mute" label={header.label} labelClass="font-medium text-mute" trailing={meta ? <span className="shrink-0 truncate text-[12px] text-dim">{meta}</span> : null} />
        )}
        {foldable && (
          <li className="flex gap-2.5">
            <Slot icon={ChevronDown} className={cn("text-dim motion-safe:transition-transform motion-safe:duration-200", EASE, expanded && "rotate-180")} />
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              aria-expanded={expanded}
              className="cursor-pointer text-[13px] leading-5 text-dim transition-colors hover:text-mute"
            >
              {expanded ? "Hide earlier steps" : `${hidden} earlier step${hidden === 1 ? "" : "s"}`}
            </button>
          </li>
        )}
        {shown.map((s, i) =>
          s.type === "thinking" ? (
            <ThinkingRow key={s.key} thoughts={s.thoughts} preview={live && i === shown.length - 1} />
          ) : (
            <Row key={s.key} item={s.item} projectId={projectId} live={live} now={now} portrait={portrait} />
          )
        )}
      </ol>
    </section>
  );
}

/** An icon on the timeline's rail, masking the rail behind it. */
function Slot({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
  return (
    <span className="relative grid size-5 shrink-0 place-items-center rounded-md bg-panel" aria-hidden>
      <Icon className={cn("size-3.5", className)} strokeWidth={2} />
    </span>
  );
}

/** One row of the timeline: an icon on the rail, a line of text with what trails it, and anything under it. */
function Line({
  icon,
  iconClass = "text-dim",
  label,
  labelClass = "text-mute",
  wrap = false,
  trailing,
  children,
}: {
  icon: LucideIcon;
  iconClass?: string;
  label: ReactNode;
  labelClass?: string;
  /** The label may run onto more lines (a note, an error) instead of being cut. */
  wrap?: boolean;
  trailing?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <li className="rise flex gap-2.5">
      <Slot icon={icon} className={iconClass} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2 text-[13px] leading-5">
          <span className={cn("min-w-0 flex-1", wrap ? "break-words" : "truncate", labelClass)}>{label}</span>
          {trailing}
        </div>
        {children}
      </div>
    </li>
  );
}

/** How a step stands: its time (live while it runs) and a mark, read out as words. */
function Status({ status, ms }: { status: FeedStatus; ms: number | null }) {
  return (
    <span className="flex h-5 shrink-0 items-center gap-1.5 text-[11px] text-dim">
      {ms !== null && <span className="font-mono tabular-nums">{clock(ms)}</span>}
      {status === "running" ? (
        <LoaderCircle className="size-3.5 text-accent motion-safe:animate-spin" aria-hidden />
      ) : status === "done" ? (
        <Check className="size-3.5 text-ok" strokeWidth={2.5} aria-hidden />
      ) : status === "error" ? (
        <TriangleAlert className="size-3.5 text-warn" aria-hidden />
      ) : (
        <CircleSlash className="size-3.5 text-dim" aria-hidden />
      )}
      <span className="sr-only">{STATUS_TEXT[status]}</span>
    </span>
  );
}

function Row({ item, projectId, live, now, portrait }: { item: FeedRow; projectId: string; live: boolean; now: number; portrait: boolean }) {
  switch (item.kind) {
    case "note":
      return <Line icon={item.level === "warn" ? TriangleAlert : Info} iconClass={item.level === "warn" ? "text-warn" : "text-dim"} label={item.text} labelClass="text-[12.5px] text-dim" wrap />;
    case "done":
      return (
        <Line
          icon={CheckCheck}
          iconClass="text-ok"
          label={`Finished in ${clock(item.ms)}`}
          trailing={item.turns > 0 ? <span className="h-5 shrink-0 text-[11px] leading-5 text-dim tabular-nums">{item.turns} turns</span> : null}
        />
      );
    case "error":
      return item.stopped ? (
        <Line icon={CircleSlash} label="Stopped" labelClass="text-dim" />
      ) : (
        <Line icon={TriangleAlert} iconClass="text-bad" label={<span className="line-clamp-3 whitespace-pre-line">{item.text}</span>} labelClass="text-bad" wrap />
      );
    default: {
      // a step a finished run left running (a server restart): it never finished
      const status: FeedStatus = item.status === "running" && !live ? "stopped" : item.status;
      const ms = status === "running" ? now - item.at : item.end !== undefined && item.end - item.at >= 1000 ? item.end - item.at : null;
      const icon = item.kind === "step" ? STEP_ICON[item.icon] : item.kind === "stills" ? Images : item.kind === "check" ? ShieldCheck : Mic;
      const count = item.kind === "step" && item.count && item.count > 1 ? item.count : 0;
      return (
        <Line
          icon={icon}
          iconClass={status === "running" ? "text-accent" : "text-dim"}
          label={
            <>
              {item.label}
              {count > 0 && <span className="text-dim tabular-nums"> ×{count}</span>}
            </>
          }
          labelClass={status === "running" ? "text-fg" : status === "stopped" ? "text-dim" : "text-mute"}
          trailing={<Status status={status} ms={ms} />}
        >
          {item.kind === "narration" && item.text && <p className="mt-0.5 line-clamp-2 text-[12.5px] italic leading-relaxed text-mute">“{item.text}”</p>}
          {item.detail && <p className={cn("truncate text-[12px] leading-5", item.status === "error" ? "text-warn" : "text-dim")} title={item.detail}>{item.detail}</p>}
          {item.kind === "stills" && item.frames.length > 0 && <FrameStrip projectId={projectId} frames={item.frames} portrait={portrait} />}
        </Line>
      );
    }
  }
}

/** The agent's notes between its steps, folded under "Thinking details"; the latest one previewed while the run goes on. */
function ThinkingRow({ thoughts, preview }: { thoughts: Thought[]; preview: boolean }) {
  const [open, setOpen] = useState(false);
  const panel = useId();
  return (
    <li className="rise flex gap-2.5">
      <Slot icon={Brain} className="text-dim" />
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={panel}
          className="flex max-w-full cursor-pointer items-center gap-1.5 text-left text-[13px] leading-5 text-dim transition-colors hover:text-mute"
        >
          Thinking details
          {thoughts.length > 1 && <span className="tabular-nums">· {thoughts.length}</span>}
          <ChevronDown className={cn("size-3.5 shrink-0 motion-safe:transition-transform motion-safe:duration-200", EASE, open && "rotate-180")} aria-hidden />
        </button>
        {preview && !open && (
          <p className="truncate text-[12px] leading-5 text-dim">
            {thoughts
              .at(-1)!
              .text.split("\n")
              .find((l) => l.trim())
              ?.replace(/^[#>*\-\s]+/, "")}
          </p>
        )}
        <div className={cn("grid motion-safe:transition-[grid-template-rows] motion-safe:duration-200", EASE, open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
          <div id={panel} className="min-h-0 overflow-hidden" inert={!open}>
            <div className="mt-1.5 space-y-2.5 border-l-2 border-line pb-1 pl-3 text-[12.5px] leading-relaxed text-mute">
              {thoughts.map((t) => (
                <p key={t.id} className="whitespace-pre-wrap break-words">
                  {t.text}
                </p>
              ))}
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}

/** A stills round's frames as a row of thumbnails (the last cell says how many more); any of them opens large. */
function FrameStrip({ projectId, frames, portrait }: { projectId: string; frames: FeedFrame[]; portrait: boolean }) {
  const [viewing, setViewing] = useState<number | null>(null);
  const thumbs = frames.length > THUMBS ? frames.slice(0, THUMBS - 1) : frames;
  const more = frames.length - thumbs.length;
  const cell = cn(
    "relative cursor-pointer overflow-hidden rounded-md border border-line bg-raised transition-[transform,border-color] duration-150 ease-out hover:border-line-hi active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-accent",
    portrait ? "aspect-[9/16]" : "aspect-video"
  );
  return (
    <>
      <div className="mt-1.5 grid grid-cols-6 gap-1.5">
        {thumbs.map((f, i) => (
          <button key={`${f.round}/${f.file}`} type="button" onClick={() => setViewing(i)} className={cell} title={frameAlt(f)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={reviewFrameUrl(projectId, f)}
              alt={frameAlt(f)}
              loading="lazy"
              decoding="async"
              onError={(e) => void (e.currentTarget.style.visibility = "hidden")}
              className="size-full object-cover"
            />
          </button>
        ))}
        {more > 0 && (
          <button type="button" onClick={() => setViewing(thumbs.length)} aria-label={`View all ${frames.length} frames`} className={cn(cell, "grid place-items-center bg-panel-hi text-[12px] font-medium text-mute tabular-nums hover:text-fg")}>
            +{more}
          </button>
        )}
      </div>
      {viewing !== null && <FrameViewer projectId={projectId} frames={frames} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} portrait={portrait} />}
    </>
  );
}

/** A round's frames large, one at a time: arrows (or ← →) step through them, Esc or a click outside closes. */
function FrameViewer({
  projectId,
  frames,
  index,
  onIndex,
  onClose,
  portrait,
}: {
  projectId: string;
  frames: FeedFrame[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  portrait: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const frame = frames[index]!;
  const step = (d: number) => onIndex((index + d + frames.length) % frames.length);
  const many = frames.length > 1;

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-label="Review frames"
      onClose={onClose}
      onClick={(e) => e.target === ref.current && ref.current?.close()}
      onKeyDown={(e) => {
        if (!many) return;
        if (e.key === "ArrowRight") step(1);
        if (e.key === "ArrowLeft") step(-1);
      }}
      className="m-auto max-h-none max-w-none bg-transparent p-0 backdrop:bg-black/80 backdrop:backdrop-blur-sm"
    >
      <figure className={cn("rise flex flex-col items-center gap-3", portrait ? "w-[min(92vw,calc(78vh*9/16))]" : "w-[min(92vw,1100px)]")}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={reviewFrameUrl(projectId, frame)}
          alt={frameAlt(frame)}
          className={cn("max-h-[78vh] w-full rounded-xl bg-black object-contain shadow-2xl", portrait ? "aspect-[9/16]" : "aspect-video")}
        />
        <figcaption className="flex w-full items-center justify-between gap-3 text-white">
          {many ? (
            <button type="button" onClick={() => step(-1)} aria-label="Previous frame" className="cursor-pointer rounded-full p-2 transition-colors hover:bg-white/10">
              <ChevronLeft className="size-5" />
            </button>
          ) : (
            <span className="size-9" />
          )}
          <div className="text-center">
            <div className="text-sm font-medium">
              Frame {frame.frame} · {frame.seconds.toFixed(1)} s
            </div>
            <div className="font-mono text-xs text-white/60">
              {index + 1} / {frames.length} · round {Number(frame.round.slice(1))}
            </div>
          </div>
          <div className="flex items-center">
            {many && (
              <button type="button" onClick={() => step(1)} aria-label="Next frame" className="cursor-pointer rounded-full p-2 transition-colors hover:bg-white/10">
                <ChevronRight className="size-5" />
              </button>
            )}
            <button type="button" onClick={() => ref.current?.close()} aria-label="Close" className="cursor-pointer rounded-full p-2 transition-colors hover:bg-white/10">
              <X className="size-5" />
            </button>
          </div>
        </figcaption>
      </figure>
    </dialog>
  );
}
