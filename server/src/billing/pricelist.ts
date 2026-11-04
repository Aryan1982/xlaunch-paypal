import { config, DEFAULT_MODEL, modelLabel, motionModelFor, OFFERED_MODELS } from "../config";
import { CHAT_ASK_ABOVE } from "./catalog";
import { changePrice, creditsFor, HOLD_FACTOR, MARKUP, MIN_CHANGE, narrationUsd, sceneUsd, VIDEO_FEE, videoPrice, type JobModels } from "./meter";

/** A film's typical credits: every film is config.motion.seconds long. */
const filmPrice = (m: JobModels): number => videoPrice(m, config.motion.seconds).estimate;

/**
 * What things typically cost, in credits, per model (metered: the real
 * charge follows the work's model calls). The same numbers on the public
 * page, /billing, the MCP tools and in the app.
 */

/**
 * Models kept off every price list (PRICE_LIST_EXCLUDE, comma separated):
 * a model on trial stays in the picker (/api/models) and is metered as usual,
 * but no page quotes it (home page, Credits page, /api/pricing, llms.txt).
 */
const excluded = (): Set<string> =>
  new Set((process.env.PRICE_LIST_EXCLUDE ?? "").split(",").map((m) => m.trim()).filter(Boolean));

const costOf = (id: string) => ({
  id,
  label: modelLabel(id),
  /** A 2D film (config.motion.seconds), made by the film agent with this model. */
  video: filmPrice({ coder: motionModelFor(id), motion: true }),
  /** The same as a 3D film (the 3D tab). */
  film3d: filmPrice({ coder: motionModelFor(id), motion: true, film3d: true }),
  perScene: changePrice(sceneUsd({ coder: id })).estimate,
});

/** The models on offer (OFFERED_MODELS, less any PRICE_LIST_EXCLUDE), cheapest first; each makes 2D and 3D films. */
export const modelLineup = () => {
  const out = excluded();
  return OFFERED_MODELS.filter((m) => !out.has(m.id))
    .map((m) => ({ ...costOf(m.id), available: true, modes: ["2d", "3d"] as Array<"2d" | "3d"> }))
    .sort((a, b) => a.video - b.video);
};

export const priceList = () => {
  const lineup = modelLineup();
  return {
    /** Every film's length in seconds (config.motion.seconds): what the prices below are for. */
    seconds: config.motion.seconds,
    /** Typical cost of a film with the default model, 2D and 3D. */
    video: { "2d": filmPrice({ coder: DEFAULT_MODEL, motion: true }), "3d": filmPrice({ coder: DEFAULT_MODEL, motion: true, film3d: true }) },
    /** The same per model: the models on offer, for 2D and for 3D films. */
    models: { "2d": lineup, "3d": lineup },
    /** The models on offer with their typical costs. */
    lineup,
    /** Chat changes: about `perScene` per rewritten scene (default model), at least `min`; above `askAbove` the user confirms first. */
    change: { perScene: changePrice(sceneUsd({ coder: DEFAULT_MODEL })).estimate, min: MIN_CHANGE, askAbove: CHAT_ASK_ABOVE },
    /** Narration on top of a film's price (ElevenLabs bills its characters). */
    narration: creditsFor(narrationUsd(config.motion.seconds)),
    /** How credits are worked out. */
    metered: { markup: MARKUP, videoFee: VIDEO_FEE, holdFactor: HOLD_FACTOR },
  };
};
