import fs from "fs/promises";
import path from "path";
import { setTimeout as sleep } from "timers/promises";

import { z } from "zod";

import { coderModelFor, config } from "../config";
import { Stopped, stopRequested, withCallLog } from "../lib/calls";
import { assertFilmAgent } from "../lib/retired";
import { UpstreamError, InferenceError } from "../opencode";
import { log, projectDir, say, setActivity, updateProject, getProject } from "../store";
import { type Project } from "../types";
import { attachToFilm, runMotionAgent, workspaceOf, type MotionRun } from "./motion-agent";
import { isRendering } from "./render";
import { Semaphore } from "../lib/semaphore";
import { ensureWorkdir, syncProject } from "../workdir";
import { CHAT_ASK_ABOVE } from "../billing/catalog";
import { changePrice, meteredCredits, motionUsd, projectUsd } from "../billing/meter";
import type { Charge } from "../billing/credits";
import { modelsOf } from "../billing/jobs";

const active = new Set<string>();

export const isBusy = (id: string): boolean => active.has(id);
/** Projects with a pipeline job running or queued. */
export const busyProjects = (): string[] => Array.from(active);

const errorMessage = (error: unknown): string => {
  if (error instanceof UpstreamError || error instanceof InferenceError) return error.message;
  return error instanceof Error ? error.message : String(error);
};

/**
 * Jobs running at once across all projects (each one drives a browser and
 * several parallel model calls). The rest wait their turn, in order.
 */
const jobs = new Semaphore(Math.max(1, Number(process.env.MAX_JOBS ?? 2)));

/** The running job's stop switch, per project. */
const stops = new Map<string, AbortController>();

export const STOPPED_MESSAGE = "You stopped this, so its credits aren't refunded. Retry runs it again.";

/** Stop the project's running (or queued) job. False when nothing is running. */
export const stopJob = (id: string): boolean => {
  const stop = stops.get(id);
  if (!stop) return false;
  // asked again while it winds down: still stopping, not "nothing is running"
  if (!stop.signal.aborted) stop.abort();
  return true;
};

/** Run `work` as the one active pipeline job for a project. */
const exclusive = async (id: string, work: () => Promise<void>): Promise<void> => {
  const owning = await getProject(id).catch(() => null);
  // a film from the retired scene studio can't be built or changed again
  if (owning) assertFilmAgent(owning);
  if (active.has(id)) throw new Error("This project is already busy.");
  active.add(id);
  const stop = new AbortController();
  stops.set(id, stop);
  const owner = owning?.userId ?? null;
  // the effort the user picked for this project, for every Claude call the job makes
  const effort = owning?.options.effort;
  let release: (() => void) | null = null;
  try {
    release = await jobs.acquire((ahead) =>
      void updateProject(id, (p) => {
        p.activity = ahead > 0 ? `Queued: ${ahead} video${ahead > 1 ? "s" : ""} ahead of yours` : "Starting";
      }).catch(() => undefined)
    );
    if (stop.signal.aborted) throw new Stopped();
    await updateProject(id, (p) => {
      p.jobStartedAt = Date.now();
      p.jobEndedAt = undefined;
      p.steps = [];
      p.stopped = undefined;
    });
    // a fresh server restores the project's files from storage first
    await ensureWorkdir(id);
    // every model call made by this job reports its timing to the project's log, and is billed to its owner
    await withCallLog((message, level) => void log(id, message, level), work, {
      projectId: id,
      ...(owner ? { userId: owner } : {}),
      ...(effort ? { effort } : {}),
      signal: stop.signal,
    });
    // stopped, but a step caught the aborted call and carried on: the result can't stand (a job that
    // already put the video back as it was, like a change stopped while being planned, ends "ready")
    if (stop.signal.aborted && (await getProject(id)).stage !== "ready") throw new Stopped();
  } catch (error) {
    if (stop.signal.aborted) {
      await updateProject(id, (p) => {
        // stopped before it changed anything: a finished video stays as it was
        if (p.stage === "ready") return;
        p.stage = "error";
        p.error = STOPPED_MESSAGE;
        p.stopped = true;
        p.activity = "Stopped";
        p.log.push({ at: Date.now(), level: "info", message: "Stopped by the user" });
      });
      return;
    }
    console.error(`[pipeline:${id}]`, error);
    await updateProject(id, (p) => {
      p.stage = "error";
      p.error = errorMessage(error);
      p.activity = "Something went wrong";
      p.log.push({ at: Date.now(), level: "error", message: errorMessage(error) });
    });
  } finally {
    stops.delete(id);
    await updateProject(id, (p) => {
      const now = Date.now();
      const open = p.steps?.[p.steps.length - 1];
      if (open && open.end === undefined) open.end = now;
      p.jobEndedAt = now;
    }).catch(() => undefined);
    release?.();
    active.delete(id);
    void syncProject(id, owner);
  }
};

// ---------------------------------------------------------------------------
// The film: made by the film agent
// ---------------------------------------------------------------------------

/**
 * A film made by the film agent (mode "motion") in its own Remotion workspace
 * (pipeline/motion-agent.ts); a change resumes its session. The film shows as
 * soon as its code passes the check (a free preview: stage "preview", its
 * opening only); an MP4 is rendered only when the user exports it.
 */
const doMotion = async (id: string, run: MotionRun): Promise<void> => {
  await updateProject(id, (p) => {
    p.error = undefined;
  });
  const started = Date.now();
  await runMotionAgent(id, run, async () => {
    const project = await getProject(id);
    const frames = project.motionAgent?.frames ?? [];
    if (frames.length) await fs.copyFile(path.join(workspaceOf(id), frames[Math.floor(frames.length / 2)]), path.join(projectDir(id), "thumbnail.jpg")).catch(() => undefined);
    const preview = run.kind === "preview";
    await updateProject(id, (p) => {
      p.version += 1;
      p.stage = preview ? "preview" : "ready";
      p.activity = preview ? "Your film is planned" : "Your video is ready";
      // an earlier export is of the film as it was
      p.render = { state: "idle", progress: 0 };
      // a preview plays only as far as it was built (its cut, config.motion.previewSeconds); a finished film plays whole
      if (p.motionAgent && !preview) p.motionAgent.cut = undefined;
    });
    await log(id, `${run.kind === "change" ? "Changed" : run.kind === "preview" ? "Previewed" : "Made"} the film in ${Math.round((Date.now() - started) / 1000)}s`);
    const summary = project.motionAgent?.summary?.trim();
    if (preview) {
      const cut = Math.round(project.motionAgent?.cut ?? config.motion.previewSeconds);
      await say(id, `Here are the first ${cut} seconds of your ${config.motion.seconds}-second film, and the plan for all of it. Get the full film to see the rest.`);
    } else {
      await say(id, run.kind === "change" ? summary || "Done." : `${summary ? `${summary}\n\n` : ""}Your film is ready. Tell me what to change, or export it as an MP4.`);
    }
  });
};

/** Fresh project: the film agent makes the film (it reads the links itself). */
export const runAll = (id: string): Promise<void> => exclusive(id, () => doMotion(id, { kind: "film" }));

/**
 * A free preview: the film agent plans the whole film and builds its opening,
 * then waits for the user to pay (stage "preview"). Paying runs runFromPreview;
 * a preview that failed before it was ready runs this again.
 */
export const runPreview = (id: string): Promise<void> => exclusive(id, () => doMotion(id, { kind: "preview" }));

/** A free preview not paid for yet (and not deleted): it may plan and build its opening, nothing more. */
export const isUnpaidPreview = (p: Pick<Project, "options" | "charge" | "deletedAt">): boolean => !!p.options.freePreview && !p.charge && !p.deletedAt;

/** A preview paid for: the same session builds the rest of the film it planned. */
export const runFromPreview = (id: string): Promise<void> => exclusive(id, () => doMotion(id, { kind: "finish" }));

/** Continue after a failure. */
export const runResume = (id: string): Promise<void> =>
  exclusive(id, async () => {
    const first = await getProject(id);
    // a paid preview whose finishing failed is finished again, not made from scratch
    await doMotion(id, first.options.freePreview && first.version > 0 ? { kind: "finish" } : { kind: "film" });
  });

// ---------------------------------------------------------------------------
// Chat revisions
// ---------------------------------------------------------------------------

/** A change asked for in chat: the user's words, handed to the film's agent (doMotion). */
const ActionSchema = z.object({ type: z.literal("revise_motion"), instruction: z.string().max(2000), images: z.array(z.string()).default([]) });

/** How a chat change is paid for: the route supplies it for the signed-in caller. */
export type ChatPayment = {
  /** False when nothing is charged (payments off, or an exempt admin): changes then run without asking. */
  charges: boolean;
  /** Take up to `credits` (the whole balance when it is short but covers `least`), or throw (402). */
  charge(credits: number, label: string, least?: number): Promise<Charge | null>;
  refund(held: Charge | null): Promise<void>;
  /** Give back the unused part of a held charge; resolves to the credits given back. */
  refundPart(held: Charge, credits: number): Promise<number>;
};

type ChatAction = z.infer<typeof ActionSchema>;

/** The change in a few words, for the price question. */
const CHANGE_SUMMARY = "revises the film";

const creditsText = (n: number) => `${n.toLocaleString("en-US")} credit${n === 1 ? "" : "s"}`;

/** A change awaiting the user's yes is dropped after this long. */
const PENDING_TTL_MS = 30 * 60 * 1000;

const backToReady = (id: string) =>
  updateProject(id, (p) => {
    p.stage = "ready";
    p.activity = "Your video is ready";
  });

/**
 * A change asked for in chat: priced at a typical film revision, then either
 * applied (its estimate held, its metered cost charged, refunded if it fails),
 * or, above CHAT_ASK_ABOVE, held for the user to confirm.
 */
export const runChat = (id: string, message: string, pay: ChatPayment, model?: string, references: string[] = [], said = false): Promise<void> =>
  exclusive(id, async () => {
    if (model) {
      await updateProject(id, (p) => {
        // checked by the caller (a pairing only for an admin)
        p.options.model = coderModelFor(model);
      });
    }
    // a new request replaces one still waiting for a yes
    await updateProject(id, (p) => {
      p.pendingChange = undefined;
    });
    // reference images attached to this message: the film's agent looks at them itself, in its workspace (public/uploads/)
    const images = references.length ? attachToFilm(id, references) : [];
    const project = await getProject(id);
    if (project.stage !== "ready") throw new Error("The video is not ready to revise yet.");
    if (!said) await say(id, message, "user", "reply", references);
    // the film is changed by handing its agent the user's words: no planner call
    const actions: ChatAction[] = [{ type: "revise_motion", instruction: message.slice(0, 2000), images }];
    let cost = 0;
    let least = 0;
    try {
      await setActivity(id, "Thinking about your change", "directing");
      // metered: the typical cost is shown, up to HOLD_FACTOR times it is held, what it really uses is charged
      const price = changePrice(motionUsd(modelsOf(project)));
      cost = price.hold;
      least = price.estimate;
      if (pay.charges && price.estimate > CHAT_ASK_ABOVE) {
        await updateProject(id, (p) => {
          p.pendingChange = { actions, credits: price.hold, estimate: price.estimate, message, summary: CHANGE_SUMMARY, at: Date.now() };
          p.stage = "ready";
          p.activity = "Your video is ready";
        });
        await say(id, `This change ${CHANGE_SUMMARY}: about ${creditsText(price.estimate)}, and never more than ${creditsText(price.hold)} (you pay for what it actually uses). Confirm to go ahead.`, "assistant", "reply");
        return;
      }
    } catch (error) {
      await backToReady(id);
      // stopped before it was applied: nothing was changed or charged
      await say(id, stopRequested() ? "Stopped. Nothing was changed." : `I couldn't plan that: ${errorMessage(error)}`, "assistant", "reply");
      return;
    }
    await payAndApply(id, actions, cost, pay, least);
  });

/** The latest payment and model of each film with changes waiting (the job they wait for is in this process). */
const waiting = new Map<string, { pay: ChatPayment; model?: string }>();

/**
 * A change asked for while a motion film is being made: noted in the chat and
 * applied as one change request, with every other one asked for meanwhile, the
 * moment the film is done. Nothing interrupts the agent mid-film.
 */
export const queueChange = async (id: string, message: string, pay: ChatPayment, model?: string, references: string[] = []): Promise<void> => {
  await updateProject(id, (p) => {
    p.queuedChanges = [...(p.queuedChanges ?? []), { text: message, references }];
  });
  await say(id, message, "user", "reply", references);
  await say(id, "Noted. I'll make this change as soon as the film is done.", "assistant", "reply");
  const already = waiting.has(id);
  waiting.set(id, { pay, model });
  if (already) return;
  try {
    // an export renders the published film: its next change waits for it too
    while (isBusy(id) || isRendering(id)) await sleep(2000);
    const project = await getProject(id);
    const queued = project.queuedChanges ?? [];
    const { pay: latest, model: chosen } = waiting.get(id) ?? { pay };
    waiting.delete(id);
    await updateProject(id, (p) => {
      p.queuedChanges = undefined;
    });
    if (queued.length === 0) return;
    if (project.stage !== "ready") {
      await say(id, "The film didn't finish, so I didn't make your change. Once it's ready, ask again.", "assistant", "reply");
      return;
    }
    const text = queued.map((q) => q.text).join("\n\n");
    await runChat(id, text, latest, chosen, queued.flatMap((q) => q.references), true);
  } finally {
    waiting.delete(id);
  }
};

/** Apply a change the user confirmed, at the price they were shown. */
export const confirmChat = (id: string, pay: ChatPayment): Promise<void> =>
  exclusive(id, async () => {
    const pending = (await getProject(id)).pendingChange;
    await updateProject(id, (p) => {
      p.pendingChange = undefined;
    });
    if (!pending || Date.now() - pending.at > PENDING_TTL_MS) {
      await say(id, "That change expired. Ask for it again.", "assistant", "reply");
      return;
    }
    await payAndApply(id, z.array(ActionSchema).parse(pending.actions), pending.credits, pay, pending.estimate);
  });

/** Drop a change waiting for confirmation. */
export const cancelChat = async (id: string): Promise<void> => {
  await updateProject(id, (p) => {
    p.pendingChange = undefined;
  });
  await say(id, "Okay, I left the video as it is.", "assistant", "reply");
};

const payAndApply = async (id: string, actions: ChatAction[], cost: number, pay: ChatPayment, least = cost): Promise<void> => {
  let held: Charge | null = null;
  if (pay.charges && cost > 0) {
    try {
      held = await pay.charge(cost, "chat revision", least);
    } catch (error) {
      await backToReady(id);
      await say(id, `${errorMessage(error)} Get more on the Credits page, then ask again.`, "assistant", "reply");
      return;
    }
  }
  const before = projectUsd(id);
  // charge what the work used (never more than held) and give the rest back
  const settle = async (): Promise<number> => {
    if (!held) return 0;
    const used = meteredCredits(projectUsd(id) - before, held.credits);
    return held.credits - (await pay.refundPart(held, held.credits - used));
  };
  try {
    await applyChat(id, actions);
    const used = await settle();
    await say(id, held ? `Done — the preview is updated (${creditsText(used)}).` : "Done — the preview is updated.");
  } catch (error) {
    // stopped partway: what it used is charged, and the job ends as stopped (Retry finishes it)
    if (stopRequested()) {
      await settle();
      throw error;
    }
    // A failed revision must not take the existing video away, or the credits.
    await pay.refund(held);
    await backToReady(id);
    await say(id, `I couldn't apply that: ${errorMessage(error)}${held ? ` Your ${creditsText(held.credits)} are back.` : ""}`, "assistant", "reply");
  }
};

const applyChat = async (id: string, actions: ChatAction[]): Promise<void> => {
  for (const action of actions) await doMotion(id, { kind: "change", request: action.instruction, images: action.images });
};
