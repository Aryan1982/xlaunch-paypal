import type { Account } from "../auth";
import { coderModelFor, modelLabel, motionModelFor } from "../config";
import { HttpError } from "../lib/http";
import { getProject, updateProject } from "../store";
import type { Project } from "../types";
import { db, must } from "../db";
import { billingEnabled, chargeUpTo, newRef, refund, refundPart, type Charge } from "./credits";
import { meteredCredits, projectUsd, videoPrice, VIDEO_FEE, type JobModels } from "./meter";

/**
 * Charging for pipeline work, metered. A video holds its estimate up front;
 * each of its jobs adds what its model calls cost; once the video is
 * delivered (or stopped) it is charged that cost plus a flat fee, never more
 * than the hold, and the rest comes back. A video that fails is refunded in
 * full. Jobs run detached, so `settle*` runs after the job and reads the
 * outcome off the project.
 */

/** The models a project's video runs on (priced into the hold). */
export const modelsOf = (project: Pick<Project, "options">): JobModels => ({
  // a motion film is one agent session on a Claude model; a retired scene-studio project is priced on the default
  coder: project.options.mode === "motion" ? motionModelFor(project.options.model) : coderModelFor(project.options.model),
  narration: !!project.options.narration,
  motion: project.options.mode === "motion",
  film3d: !!project.options.film3d,
});

/** What a project's video typically costs and what is held for it. */
export const videoPriceOf = (project: Pick<Project, "options">): { estimate: number; hold: number } =>
  videoPrice(modelsOf(project), project.options.length);

/** The credits a project's video is priced at (its estimate): what a full rebuild by chat compares to. */
export const videoCostOf = (project: Pick<Project, "options">): number => videoPriceOf(project).estimate;

/** Out of credits for this model: say what starting needs, that most of it comes back, and the way out. */
export const notEnoughFor = (model: string, price: { estimate: number; hold: number }, balance: number): string => {
  const n = (v: number) => v.toLocaleString("en-US");
  return (
    `A ${modelLabel(model)} video typically uses about ${n(price.estimate)} credits, and you have ${n(Math.max(0, balance))}. ` +
    `Top up, or pick a cheaper model.`
  );
};

const hold = async (account: Account, project: Project, reason: string): Promise<void> => {
  const price = videoPriceOf(project);
  let held: Charge | null;
  try {
    // up to the full hold; a smaller balance that covers the typical cost is held whole instead
    held = await chargeUpTo(account, price.hold, price.estimate, reason, project.id, newRef("video", project.id));
  } catch (error) {
    if (error instanceof HttpError && error.details.code === "credits") {
      throw new HttpError(402, notEnoughFor(modelsOf(project).coder, price, Number(error.details.balance ?? 0)), error.details);
    }
    throw error;
  }
  if (held) {
    await updateProject(project.id, (p) => {
      p.charge = { ref: held.ref, credits: held.credits, state: "held", estimate: price.estimate, usd: 0 };
    });
  }
};

/** Hold a new video's estimate (a free preview's finish too) and record it on the project. */
export const chargeVideo = async (account: Account, project: Project): Promise<void> => hold(account, project, "video");

/**
 * Before continuing a video (retry): a video refunded after failing, or
 * settled after a stop, is paid for again. Held or delivered videos, and
 * projects made free, continue at no cost.
 */
export const ensureVideoCharge = async (account: Account, projectId: string): Promise<void> => {
  const project = await getProject(projectId);
  // a free preview has no charge yet: going past it is the video, paid for like any other
  if (project.options.freePreview && !project.charge) return hold(account, project, "video");
  if (project.charge?.state !== "refunded" && project.charge?.state !== "spent") return;
  await hold(account, project, "video retry");
};

/**
 * Run a job that builds the video and meter it: its model cost is added to
 * the video's charge; the first time the video reaches "ready" the charge
 * settles to what it used; if it ends in "error" first, it is refunded. A job
 * that pauses (at the brief) leaves the charge held, its cost so far kept.
 */
export const settleVideo = async (id: string, run: () => Promise<void>): Promise<void> => {
  const before = projectUsd(id);
  await run().catch(() => undefined);
  const usd = projectUsd(id) - before;
  if (usd > 0) {
    await updateProject(id, (p) => {
      if (p.charge?.state === "held") p.charge.usd = (p.charge.usd ?? 0) + usd;
    }).catch(() => undefined);
  }
  await settleHeld(id);
};

/** A held video charge, settled to its metered cost (`state`), the unused hold given back. */
const settleUsed = async (id: string, held: NonNullable<Project["charge"]>, state: "delivered" | "spent"): Promise<void> => {
  const used = meteredCredits(held.usd ?? 0, held.credits, VIDEO_FEE);
  const back = await refundPart(held, held.credits - used, state === "spent" ? "video stopped: unused credits" : "video: unused credits");
  await updateProject(id, (p) => {
    if (p.charge?.ref !== held.ref) return;
    p.charge.state = state;
    p.charge.charged = held.credits - back;
  });
  console.log(`[billing] video ${id} ${state}: ${held.credits - back} credits ($${(held.usd ?? 0).toFixed(3)} of model calls), ${back} back`);
};

const settleHeld = async (id: string): Promise<void> => {
  const project = await getProject(id).catch(() => null);
  const held = project?.charge;
  if (!project || held?.state !== "held") return;
  if (project.stopped) {
    // stopped: what it used so far is charged, the rest of the hold comes back
    await settleUsed(id, held, "spent");
  } else if (project.stage === "ready") {
    await settleUsed(id, held, "delivered");
  } else if (project.stage === "error") {
    const back = await refund(held, "video failed");
    await updateProject(id, (p) => {
      if (p.charge?.ref === held.ref) {
        p.charge.state = "refunded";
        p.charge.charged = 0;
      }
    });
    if (back) console.log(`[billing] refunded ${held.credits} credits for failed video ${id}`);
  }
};

/**
 * At boot: a video whose job died with the last process (deploy, crash) still
 * holds its credits. Loading it marks an interrupted stage as "error", so it
 * settles like any failed job; a video paused at the brief stays held.
 */
export const settleInterrupted = async (): Promise<number> => {
  if (!billingEnabled()) return 0;
  const rows = must(await db().from("projects").select("id").eq("data->charge->>state", "held").limit(500), "held charges") as Array<{ id: string }>;
  let refunded = 0;
  for (const { id } of rows) {
    await settleHeld(id);
    if ((await getProject(id).catch(() => null))?.charge?.state === "refunded") refunded++;
  }
  return refunded;
};

export { chargeUpTo, newRef };
