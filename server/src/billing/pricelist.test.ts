import { afterEach, describe, expect, it, vi } from "vitest";

/** The price list (and config, prices, jobs) as loaded with this env. */
const fresh = async (env: Record<string, string>) => {
  vi.resetModules();
  vi.stubEnv("SCENE_MODE", "free");
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  (await import("../usage/prices")).setPrices({
    "qwen3.8-flash": { input: 0.15, output: 0.47 },
    "claude-sonnet-5-5": { input: 2, output: 10 },
    "claude-opus-5-5": { input: 4, output: 20 },
  });
  return { ...(await import("./pricelist")), ...(await import("./jobs")) };
};

describe("model lineup on the price list", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("lists only Sonnet 5.5 and Opus 5.5, for 2D and 3D, cheapest first", async () => {
    const { priceList } = await fresh({ PRICE_LIST_EXCLUDE: "" });
    const list = priceList();
    expect(list.lineup.map((m) => [m.id, m.label, m.available, m.modes])).toEqual([
      ["claude-sonnet-5-5", "Sonnet 5.5", true, ["2d", "3d"]],
      ["claude-opus-5-5", "Opus 5.5", true, ["2d", "3d"]],
    ]);
    expect(list.lineup[1].video).toBeGreaterThan(list.lineup[0].video);
    expect(list.models["2d"].map((m) => m.id)).toEqual(["claude-sonnet-5-5", "claude-opus-5-5"]);
    expect(list.models["3d"].map((m) => m.id)).toEqual(["claude-sonnet-5-5", "claude-opus-5-5"]);
  });

  it("leaves out a model in PRICE_LIST_EXCLUDE", async () => {
    const { priceList } = await fresh({ PRICE_LIST_EXCLUDE: " claude-opus-5-5 ,other-model" });
    expect(priceList().lineup.map((m) => m.id)).toEqual(["claude-sonnet-5-5"]);
  });
});

describe("starting a video without enough credits", () => {
  it("names the model, what starting needs (its typical cost, not the full hold), and the way out", async () => {
    const { notEnoughFor } = await fresh({});
    const text = notEnoughFor("claude-opus-5-5", { estimate: 1155, hold: 2850 }, 1000);
    expect(text).toContain("Opus 5.5");
    expect(text).not.toContain("2,850");
    expect(text).toContain("1,000");
    expect(text).toContain("about 1,155");
    expect(text).toMatch(/cheaper model/);
  });
});
