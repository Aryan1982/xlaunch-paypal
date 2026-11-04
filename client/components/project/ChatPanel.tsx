"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Brain, ChevronDown, Square } from "lucide-react";

import { api, assetUrl } from "@/lib/api";
import { useBilling } from "@/lib/use-billing";
import type { ChatMessage, Project } from "@/lib/types";
import { timelineOf } from "@/lib/timeline";
import { cn } from "@/components/ui";
import { clock, useNow } from "@/lib/use-now";
import { ModelMenu, useEffort, useModel } from "@/components/ModelPicker";
import { AttachedThumbs, useReferences } from "@/components/References";
import { PromptMenu } from "@/components/home/PromptMenu";
import { RunActivity } from "@/components/project/ActivityFeed";
import { ChatText } from "@/components/project/ChatText";

const SUGGESTIONS = ["Make it faster", "Use a light look", "Show the pricing step"];

const WORKING: Project["stage"][] = ["created", "ingesting", "profile", "directing", "storyboard", "coding", "verifying"];

export function ChatPanel({
  project,
  draft,
  setDraft,
}: {
  project: Project;
  draft: string;
  setDraft: (v: string) => void;
}) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  /** The chat is scrolled to its end: new activity keeps it there; scrolled up to read, it stays put. */
  const pinned = useRef(true);
  const area = useRef<HTMLTextAreaElement>(null);
  // 2D and 3D films change with the same models
  const [model, setModel, models] = useModel(project.options.model);
  const effort = useEffort(model, project.options.effort);
  const refs = useReferences();
  const { billing } = useBilling();
  const [deciding, setDeciding] = useState<"confirm" | "cancel" | null>(null);
  const [askStop, setAskStop] = useState(false);
  /** The job a stop was asked for (its start time), so the next job starts with a live button. */
  const [stopAsked, setStopAsked] = useState<number | null>(null);
  const pending = project.pendingChange;

  const stop = async () => {
    setAskStop(false);
    setStopAsked(project.jobStartedAt ?? 0);
    setError(null);
    try {
      await api.stop(project.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStopAsked(null);
    }
  };

  const decide = async (choice: "confirm" | "cancel") => {
    setDeciding(choice);
    setError(null);
    try {
      await (choice === "confirm" ? api.confirmChange(project.id) : api.cancelChange(project.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeciding(null);
    }
  };

  const working = WORKING.includes(project.stage);
  const ready = project.stage === "ready" || project.stage === "rendering";
  // a film being made takes changes now; they're made once it's done. One whose change failed takes the next.
  const queueing = working;
  const open = ready || queueing || (project.stage === "error" && project.version > 0);
  const canSend = open && !sending && draft.trim().length > 0;
  const messages = project.chat ?? [];
  const running = !!project.jobStartedAt && !project.jobEndedAt;
  // a job waiting for a free slot can be stopped too
  const stoppable = running || working;
  const stopping = stoppable && stopAsked !== null && stopAsked === (project.jobStartedAt ?? 0);
  const now = useNow(running);
  const steps = project.steps ?? [];
  const current = running ? steps[steps.length - 1] : undefined;
  const total = project.jobStartedAt ? (project.jobEndedAt ?? now) - project.jobStartedAt : 0;
  // a film's agent work, as a timeline between the messages (older projects have none: the drawer below)
  const feed = project.feed ?? [];
  const timeline = feed.length > 0 ? timelineOf(messages, feed) : null;
  const latestRun = feed.at(-1)?.run;
  // a step spinning in the live run says what's happening: the status line is for the moments between steps
  const stepRunning = running && feed.some((i) => i.run === latestRun && "status" in i && i.status === "running");
  const tail = feed.at(-1);
  const feedKey = `${feed.length}:${tail ? JSON.stringify(tail) : ""}`;

  // Keep the newest message in view, unless the user scrolled up to read.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !pinned.current) return;
    el.scrollTo({ top: el.scrollHeight, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [messages.length, project.activity, project.stage, feedKey]);

  // A prefilled draft (e.g. from a scene's "Rewrite") should focus the composer.
  useEffect(() => {
    if (draft && ready) area.current?.focus();
  }, [draft, ready]);

  // Auto-grow the textarea up to a limit.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [draft]);

  const send = async () => {
    if (!canSend) return;
    const text = draft.trim();
    setSending(true);
    setError(null);
    try {
      await api.chat(project.id, text, model ?? undefined, refs.payload(), effort.shown ? (effort.effort ?? undefined) : undefined);
      setDraft("");
      refs.clear();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <aside className="flex h-full min-h-0 flex-col bg-panel" aria-label="Chat">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-line px-5 text-[13px]">
        <span className="font-medium text-mute">Chat</span>
        <span className="text-dim">{working ? "Working…" : ready ? "Ready for changes" : ""}</span>
      </div>

      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 96;
        }}
        className="scroll-thin min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5"
      >
        {timeline
          ? timeline.map((entry) =>
              entry.type === "message" ? (
                <Message key={entry.message.id} message={entry.message} projectId={project.id} />
              ) : (
                <RunActivity
                  key={`run-${entry.run}`}
                  projectId={project.id}
                  header={entry.header}
                  items={entry.items}
                  live={running && entry.run === latestRun}
                  now={now}
                  portrait={project.options.aspect === "9:16"}
                  hideFinalError={entry.run === latestRun && project.stage === "error"}
                />
              )
            )
          : messages.map((m) => <Message key={m.id} message={m} projectId={project.id} />)}

        {pending && ready && (
          <div className="rise rounded-2xl border border-accent/35 bg-accent/5 p-4">
            <div className="text-[13px] font-medium">Go ahead with this change?</div>
            <div className="mt-1 text-[12px] text-mute">
              You pay what it uses: about {(pending.estimate ?? pending.credits).toLocaleString("en-US")} credits, never more than{" "}
              {pending.credits.toLocaleString("en-US")}.
            </div>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => void decide("confirm")}
                disabled={deciding !== null}
                className="h-8 cursor-pointer rounded-lg bg-fg px-3 text-[13px] font-medium text-bg transition-colors hover:bg-fg/85 disabled:opacity-60"
              >
                {deciding === "confirm" ? "Starting…" : `Go ahead · ~${(pending.estimate ?? pending.credits).toLocaleString("en-US")} credits`}
              </button>
              <button
                onClick={() => void decide("cancel")}
                disabled={deciding !== null}
                className="h-8 cursor-pointer rounded-lg px-3 text-[13px] text-mute transition-colors hover:bg-panel-hi hover:text-fg disabled:opacity-60"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {!timeline && (project.reasoning || steps.length > 0) && (
          <div>
            <button
              onClick={() => setThinkingOpen((o) => !o)}
              aria-expanded={thinkingOpen}
              className="flex items-center gap-1.5 text-[13px] text-dim transition-colors hover:text-mute cursor-pointer"
            >
              <Brain className="size-4" /> Thinking details
              {total > 0 && <span className="tabular-nums">· {running ? clock(total) : `took ${clock(total)}`}</span>}
              <ChevronDown className={cn("size-4 transition-transform", thinkingOpen && "rotate-180")} />
            </button>
            {thinkingOpen && (
              <div className="mt-2 space-y-2">
                {steps.length > 0 && (
                  <ol className="rounded-xl bg-raised p-3 text-[12px] leading-relaxed">
                    {steps.map((step, i) => (
                      <li key={`${step.at}-${i}`} className="flex items-baseline justify-between gap-3">
                        <span className={cn("min-w-0 truncate", step.end === undefined && running ? "text-fg" : "text-mute")}>{step.label}</span>
                        <span className="shrink-0 font-mono tabular-nums text-dim">{clock((step.end ?? (running ? now : step.at)) - step.at)}</span>
                      </li>
                    ))}
                  </ol>
                )}
                {project.reasoning && (
                  <pre className="scroll-thin max-h-64 overflow-auto whitespace-pre-wrap rounded-xl bg-raised p-3 font-mono text-[11.5px] leading-relaxed text-mute">
                    {project.reasoning.slice(-8000)}
                  </pre>
                )}
              </div>
            )}
          </div>
        )}

        {working && !stepRunning && (
          <div className="flex items-center gap-3 text-[13px] text-mute" role="status">
            <span className="dot-pulse flex gap-1" aria-hidden>
              <span className="size-1.5 rounded-full bg-accent" />
              <span className="size-1.5 rounded-full bg-accent" />
              <span className="size-1.5 rounded-full bg-accent" />
            </span>
            <span className="min-w-0 flex-1">{project.activity}</span>
            {current && <span className="shrink-0 font-mono tabular-nums text-dim">{clock(now - current.at)}</span>}
          </div>
        )}

        {project.stage === "error" && (
          <div
            className={cn(
              "rounded-2xl border px-4 py-3 text-[14px]",
              project.stopped ? "border-line bg-raised text-mute" : "border-bad/25 bg-bad/5 text-bad"
            )}
          >
            {project.error ?? "Something went wrong."}
          </div>
        )}
      </div>

      <div className="shrink-0 space-y-3 px-4 pb-4 pt-2">
        {ready && !draft && (
          <div className="scroll-thin flex gap-2 overflow-x-auto pb-1">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => setDraft(s)}
                className="shrink-0 rounded-full bg-panel-hi px-3 py-1.5 text-xs text-mute transition-colors hover:bg-line hover:text-fg cursor-pointer"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {error && <div className="px-1 text-[13px] text-bad">{error}</div>}
        {stoppable && askStop && !stopping && (
          <div className="rise flex items-center justify-between gap-3 rounded-xl border border-line-hi bg-raised px-3.5 py-2.5 text-[13px]">
            <span className="text-mute">Stop now? Credits for this run aren&apos;t refunded.</span>
            <span className="flex shrink-0 gap-1.5">
              <button onClick={() => setAskStop(false)} className="cursor-pointer rounded-md px-2.5 py-1 text-mute hover:bg-panel-hi hover:text-fg">
                Keep going
              </button>
              <button onClick={() => void stop()} className="cursor-pointer rounded-md bg-bad px-2.5 py-1 font-medium text-white hover:bg-bad/90">
                Stop
              </button>
            </span>
          </div>
        )}
        {ready && billing?.enabled && (
          <div className="px-1 text-[12px] text-dim">
            Each change is one quick rewrite of the film.
          </div>
        )}
        <div
          className={cn(
            "rounded-2xl border bg-panel p-2.5 transition-colors",
            open ? "border-line-hi focus-within:border-fg/40" : "border-line bg-raised"
          )}
        >
          <textarea
            ref={area}
            rows={2}
            value={draft}
            disabled={!open}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={ready ? "Refine your video…" : queueing ? "Ask for a change. It’s made as soon as the film is done…" : open ? "Ask for a change…" : working ? "Building your video…" : "Chat is unavailable right now"}
            aria-label="Message"
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
              if (files.length && open) {
                e.preventDefault();
                void refs.add(files);
              }
            }}
            className="block w-full resize-none bg-transparent px-2 py-1 text-sm leading-relaxed outline-none placeholder:text-dim disabled:cursor-not-allowed"
          />
          <AttachedThumbs refs={refs} disabled={sending} className="px-2 pt-2" />
          <div className="mt-2 flex items-center gap-2">
            <PromptMenu refs={refs} aspect={project.options.aspect ?? "16:9"} disabled={!open || sending} up />
            <span className="shrink-0 rounded-md px-1.5 py-1 font-mono text-xs text-dim" title={project.options.aspect === "9:16" ? "Vertical video" : "Landscape video"}>
              {project.options.aspect ?? "16:9"}
            </span>
            <div className="ml-auto flex min-w-0 justify-end">
              <ModelMenu value={model} models={models} onChange={setModel} effort={effort} disabled={!ready} />
            </div>
            {stoppable && !(queueing && draft.trim()) ? (
              <button
                onClick={() => setAskStop(true)}
                disabled={stopping}
                aria-label={stopping ? "Stopping" : "Stop"}
                title={stopping ? "Stopping…" : "Stop"}
                className="grid size-8 cursor-pointer place-items-center rounded-lg bg-fg text-bg transition-all hover:bg-fg/85 active:scale-95 disabled:cursor-wait disabled:opacity-50"
              >
                <Square className="size-3 fill-current" />
              </button>
            ) : (
              <button
                onClick={send}
                disabled={!canSend}
                aria-label="Send"
                className="grid size-8 place-items-center rounded-lg bg-fg text-bg transition-all hover:bg-fg/85 active:scale-95 disabled:bg-line-hi disabled:text-dim cursor-pointer disabled:cursor-not-allowed"
              >
                <ArrowUp className="size-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}

/** A chat message: the user's on the right (with the images they attached), the assistant's with its lists, bold and code. */
function Message({ message: m, projectId }: { message: ChatMessage; projectId: string }) {
  return m.role === "user" ? (
    <div className="rise flex justify-end">
      <div className="max-w-[88%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-panel-hi px-3.5 py-2.5 text-sm leading-relaxed">
        {m.text}
        {m.images?.length ? (
          <div className="mt-2.5 flex flex-wrap justify-end gap-1.5">
            {m.images.map((name) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={name} src={assetUrl(projectId, name)} alt="Attached image" className="h-16 w-24 rounded-lg border border-line object-cover" />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  ) : (
    <div className="rise break-words text-sm leading-relaxed text-fg">
      <ChatText text={m.text} />
    </div>
  );
}
