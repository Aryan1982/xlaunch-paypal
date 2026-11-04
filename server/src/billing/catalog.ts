/**
 * What XLaunch sells and what each action costs, in credits.
 *
 * SKUs are ours and never change. Dodo product ids are not in code: test mode
 * and live mode have different products, so DODO_PRODUCTS maps SKU → product
 * id per environment (scripts/billing/setup-products.ts creates the products
 * and prints that line). Prices here are what the setup script creates; Dodo
 * holds the price actually charged.
 */

export type Interval = "month" | "year";

export type Plan = {
  kind: "subscription";
  sku: string;
  name: string;
  tier: "launch" | "studio" | "scale";
  interval: Interval;
  /** Charged per interval, in cents (USD). */
  priceCents: number;
  /** Credits granted on each successful payment of this plan. */
  credits: number;
};

export type Pack = {
  kind: "pack";
  sku: string;
  name: string;
  priceCents: number;
  credits: number;
};

export type Product = Plan | Pack;

/** Subscription credits roll over up to this many periods' grant. */
export const ROLLOVER_PERIODS = 2;

/**
 * Storage each purchase entitles (MB). Exports are stored (8–13 MB each), so
 * a plan's allowance has to hold a few months of its videos. A purchase only
 * ever raises the limit, never lowers it.
 */
export const STORAGE_MB = { launch: 2_048, studio: 5_120, scale: 15_360 } as const;
export const PACK_STORAGE_MB = 1_024;

/** Founder's Pack holders get this much extra on every later pack. */
export const FOUNDER_BONUS = 0.2;
export const FOUNDER_SKU = "pack_founder";

const MONTHLY = { launch: 2_500, studio: 8_000, scale: 22_000 } as const;

const plan = (tier: Plan["tier"], name: string, interval: Interval, priceCents: number): Plan => ({
  kind: "subscription",
  sku: `sub_${tier}_${interval}`,
  name: `${name} (${interval === "month" ? "monthly" : "yearly"})`,
  tier,
  interval,
  priceCents,
  // a yearly plan is paid once a year, so it grants the year's credits up front
  credits: MONTHLY[tier] * (interval === "month" ? 1 : 12),
});

export const PRODUCTS: readonly Product[] = [
  plan("launch", "Launch", "month", 2_900),
  plan("launch", "Launch", "year", 29_000),
  plan("studio", "Studio", "month", 7_900),
  plan("studio", "Studio", "year", 79_000),
  plan("scale", "Scale", "month", 19_900),
  plan("scale", "Scale", "year", 199_000),
  // a first purchase: one 30 s film finished from its free preview (Sonnet, about 330 credits metered, estimated 512)
  // plus small changes. Its credits stay low enough that a finish uses over half of them (about 53-60%), so the
  // first-purchase guarantee (refund under half used) doesn't refund a finished film. Never discounted, so no regular price
  { kind: "pack", sku: "pack_one", name: "One video", priceCents: 1_500, credits: 550 },
  { kind: "pack", sku: "pack_single", name: "Single pack", priceCents: 1_900, credits: 1_400 },
  { kind: "pack", sku: "pack_pro", name: "Pro pack", priceCents: 4_900, credits: 3_900 },
  { kind: "pack", sku: "pack_bulk", name: "Bulk pack", priceCents: 14_900, credits: 12_500 },
  { kind: "pack", sku: FOUNDER_SKU, name: "Founder's Pack", priceCents: 29_900, credits: 30_000 },
];

export const productBySku = (sku: string): Product | undefined => PRODUCTS.find((p) => p.sku === sku);

// ---------------------------------------------------------------------------
// Launch pricing
// ---------------------------------------------------------------------------

/**
 * The prices above are launch prices, for early users, until the offer ends
 * (LAUNCH_OFFER_ENDS, an ISO date; "off" turns the offer display off). After
 * it, prices go up to these regular ones: shown struck through until then,
 * and they must be what Dodo charges from that date (scripts/billing/setup-products.ts),
 * or the struck-through price is not a real one.
 */
export const REGULAR_PRICE_CENTS: Record<string, number> = {
  sub_launch_month: 3_900,
  sub_launch_year: 39_000,
  sub_studio_month: 9_900,
  sub_studio_year: 99_000,
  sub_scale_month: 24_900,
  sub_scale_year: 249_000,
  pack_single: 2_500,
  pack_pro: 6_500,
  pack_bulk: 19_900,
  pack_founder: 39_900,
};

const DEFAULT_OFFER_ENDS = "2026-11-15";

/** When launch pricing ends (end of that day, UTC), or null when there is no offer on now. */
export const launchOfferEnds = (now = Date.now()): string | null => {
  const raw = (process.env.LAUNCH_OFFER_ENDS ?? DEFAULT_OFFER_ENDS).trim();
  if (!raw || raw === "off") return null;
  const end = Date.parse(`${raw}T23:59:59Z`);
  return Number.isFinite(end) && end > now ? raw : null;
};

/** The products as sold now: with the regular price beside each launch price while the offer lasts. */
export const productsForSale = (now = Date.now()): Array<Product & { regularPriceCents?: number }> => {
  const offer = launchOfferEnds(now) !== null;
  return PRODUCTS.map((p) => {
    const regular = REGULAR_PRICE_CENTS[p.sku];
    return offer && regular && regular > p.priceCents ? { ...p, regularPriceCents: regular } : p;
  });
};

// ---------------------------------------------------------------------------
// Dodo product ids (per environment)
// ---------------------------------------------------------------------------

/** DODO_PRODUCTS: JSON object of SKU → Dodo product id. Unknown SKUs are ignored. */
export const parseProductIds = (raw: string | undefined): Map<string, string> => {
  const out = new Map<string, string>();
  if (!raw) return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("DODO_PRODUCTS is not valid JSON (expected {\"sku\": \"pdt_...\"}).");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("DODO_PRODUCTS must be a JSON object.");
  for (const [sku, id] of Object.entries(parsed)) {
    if (productBySku(sku) && typeof id === "string" && id) out.set(sku, id);
  }
  return out;
};

let ids: Map<string, string> | null = null;
const productIds = (): Map<string, string> => (ids ??= parseProductIds(process.env.DODO_PRODUCTS));

export const productIdFor = (sku: string): string | undefined => productIds().get(sku);

export const skuForProductId = (productId: string): string | undefined => {
  for (const [sku, id] of productIds()) if (id === productId) return sku;
  return undefined;
};

/** What a subscription grants on one payment, and its rollover cap. */
export const subscriptionGrant = (plan: Plan): { credits: number; cap: number } => ({
  credits: plan.credits,
  cap: plan.credits * ROLLOVER_PERIODS,
});

// ---------------------------------------------------------------------------
// Costs
// ---------------------------------------------------------------------------

/** Videos and chat changes are metered by their model calls (billing/meter.ts). A chat change estimated above this many credits waits for the user's yes. */
export const CHAT_ASK_ABOVE = 80;

/** Credits a pack grants a buyer, with the Founder's bonus if they hold one (the Founder's Pack itself gets none). */
export const packCredits = (pack: Pack, founder: boolean): number =>
  founder && pack.sku !== FOUNDER_SKU ? Math.round(pack.credits * (1 + FOUNDER_BONUS)) : pack.credits;
