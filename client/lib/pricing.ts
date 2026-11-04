/** The public price list (GET /api/pricing), read on the server for the home page and its structured data. */

import { API_ORIGIN } from "./api-origin";

export type PricingProduct = (
  | { kind: "subscription"; sku: string; name: string; tier: "launch" | "studio" | "scale"; interval: "month" | "year"; priceCents: number; credits: number }
  | { kind: "pack"; sku: string; name: string; priceCents: number; credits: number }
) & {
  /** The regular price, shown struck through while launch pricing lasts. */
  regularPriceCents?: number;
};

/** What a model typically costs: a 2D video and a 3D film (every film is `Costs.seconds` long), a rewritten scene. */
export type ModelCost = { id: string; label: string; video: number; film3d: number; perScene: number };

/** A model on the price list: offered here (`available`), in which modes, or shown for reference (premium, not offered yet). */
export type LineupModel = ModelCost & { available: boolean; modes: Array<"2d" | "3d"> };

/**
 * Typical costs in credits. Work is metered: charged what its model calls
 * cost (x markup), plus a flat fee per video; these are the usual amounts.
 */
export type Costs = {
  /** Every film's length in seconds: what these prices are for. */
  seconds: number;
  /** With the default model (2D) and the 3D model. */
  video: Record<"2d" | "3d", number>;
  models: Record<"2d" | "3d", ModelCost[]>;
  /** Every model with its typical costs, cheapest first (missing from an older server). */
  lineup?: LineupModel[];
  change: { perScene: number; min: number; askAbove: number };
  /** Narration on top of a video's price. */
  narration?: number;
  metered: { markup: number; videoFee: number; holdFactor: number };
};

export type Pricing = {
  currency: string;
  products: PricingProduct[];
  /** Launch pricing while it lasts: until `endsAt` (an ISO date, inclusive). */
  offer?: { name: string; endsAt: string } | null;
  costs: Costs;
};

/** Null when the API can't be reached: the page leaves pricing out rather than failing. */
export const getPricing = async (): Promise<Pricing | null> => {
  try {
    const res = await fetch(`${API_ORIGIN}/api/pricing`, { next: { revalidate: 600 } });
    return res.ok ? ((await res.json()) as Pricing) : null;
  } catch {
    return null;
  }
};

/**
 * What a video costs across the models people can pick, narrated (narration
 * is on by default): the average of them, the cheapest and the dearest. The
 * model sets the price (Haiku ~70 credits, Opus ~1,200), so no single model's
 * cost stands for "a video".
 */
export const typicalVideo = (costs: Pick<Costs, "video" | "lineup" | "narration">): { average: number; cheapest: number; dearest: number } => {
  const voice = costs.narration ?? 0;
  const offered = (costs.lineup ?? []).filter((m) => m.available).map((m) => m.video + voice);
  const each = offered.length ? offered : [costs.video["2d"] + voice, costs.video["3d"] + voice];
  return { average: Math.round(each.reduce((a, b) => a + b, 0) / each.length), cheapest: Math.min(...each), dearest: Math.max(...each) };
};

/** "about 5 videos on average (2–35, by model)" for a number of credits: narrated videos across the models on offer. */
export const videosFor = (credits: number, costs: Pick<Costs, "video" | "lineup" | "narration">): string => {
  const t = typicalVideo(costs);
  const count = (each: number) => Math.max(0, Math.floor(credits / each)).toLocaleString("en-US");
  if (t.cheapest === t.dearest) return `about ${count(t.average)} videos`;
  return `about ${count(t.average)} videos on average (${count(t.dearest)}–${count(t.cheapest)}, by model)`;
};
