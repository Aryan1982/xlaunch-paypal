import { describe, expect, it } from "vitest";

import { PRODUCTS, packCredits, parseProductIds, productBySku, subscriptionGrant, type Pack, type Plan } from "./catalog";

describe("products", () => {
  it("has unique SKUs and the planned prices", () => {
    expect(new Set(PRODUCTS.map((p) => p.sku)).size).toBe(PRODUCTS.length);
    expect(productBySku("sub_studio_month")?.priceCents).toBe(7_900);
    expect(productBySku("sub_studio_year")?.priceCents).toBe(79_000);
    expect(productBySku("pack_founder")?.credits).toBe(30_000);
  });

  it("lists the One video pack first among packs", () => {
    expect(PRODUCTS.find((p) => p.kind === "pack")?.sku).toBe("pack_one");
  });

  it("grants a year of credits up front on a yearly plan, with a two-period rollover cap", () => {
    expect(subscriptionGrant(productBySku("sub_launch_month") as Plan)).toEqual({ credits: 2_500, cap: 5_000 });
    expect(subscriptionGrant(productBySku("sub_launch_year") as Plan)).toEqual({ credits: 30_000, cap: 60_000 });
  });

  it("adds the Founder's bonus to later packs, never to the Founder's Pack itself", () => {
    expect(packCredits(productBySku("pack_pro") as Pack, true)).toBe(4_680);
    expect(packCredits(productBySku("pack_pro") as Pack, false)).toBe(3_900);
    expect(packCredits(productBySku("pack_founder") as Pack, true)).toBe(30_000);
  });
});

describe("DODO_PRODUCTS", () => {
  it("maps known SKUs and ignores unknown ones", () => {
    const ids = parseProductIds('{"pack_pro":"pdt_1","sub_scale_year":"pdt_2","pack_nonsense":"pdt_3"}');
    expect([...ids]).toEqual([["pack_pro", "pdt_1"], ["sub_scale_year", "pdt_2"]]);
  });

  it("is empty when unset and refuses malformed input", () => {
    expect(parseProductIds(undefined).size).toBe(0);
    expect(() => parseProductIds("not json")).toThrow(/valid JSON/);
    expect(() => parseProductIds("[]")).toThrow(/object/);
  });
});

describe("launch pricing", () => {
  it("shows each regular price above the launch price until the offer ends, then none", async () => {
    const { launchOfferEnds, productsForSale, PRODUCTS, REGULAR_PRICE_CENTS } = await import("./catalog");
    const before = Date.parse("2026-10-14T12:00:00Z");
    const after = Date.parse("2026-11-16T00:00:01Z");
    expect(launchOfferEnds(before)).toBe("2026-11-15");
    expect(launchOfferEnds(after)).toBeNull();
    for (const p of productsForSale(before)) {
      // the price charged is unchanged: only the regular one is added
      expect(p.priceCents).toBe(PRODUCTS.find((x) => x.sku === p.sku)!.priceCents);
      expect(p.regularPriceCents).toBe(REGULAR_PRICE_CENTS[p.sku]);
      if (p.regularPriceCents !== undefined) expect(p.regularPriceCents).toBeGreaterThan(p.priceCents);
    }
    // the One video pack is never discounted: no struck-through price
    expect(productsForSale(before).find((p) => p.sku === "pack_one")).not.toHaveProperty("regularPriceCents");
    expect(productsForSale(after).some((p) => "regularPriceCents" in p)).toBe(false);
  });

  it("can be switched off", async () => {
    process.env.LAUNCH_OFFER_ENDS = "off";
    const { launchOfferEnds } = await import("./catalog");
    expect(launchOfferEnds()).toBeNull();
    delete process.env.LAUNCH_OFFER_ENDS;
  });
});
