import { beforeAll, describe, expect, it } from "vitest";

import { setPrices } from "../usage/prices";
import { changePrice, creditsFor, CREDITS_PER_USD, MARKUP, meteredCredits, MIN_CHANGE, sceneUsd, VIDEO_FEE, videoPrice } from "./meter";

const GLM = { coder: "glm-5.3-flash", writer: "qwen3.8-flash", vision: "qwen3.8-flash" };
const OPUS = { ...GLM, coder: "claude-opus-5-5" };

beforeAll(() => {
  setPrices({
    "glm-5.3-flash": { input: 0.15, output: 0.5 },
    "qwen3.8-flash": { input: 0.15, output: 0.47 },
    "claude-opus-5-5": { input: 4, output: 20 },
  });
});

describe("metered credits", () => {
  it("turn model cost into credits at the markup, rounding up", () => {
    expect(MARKUP).toBe(5);
    expect(creditsFor(0)).toBe(0);
    expect(creditsFor(1)).toBe(Math.ceil(5 * CREDITS_PER_USD));
    // the markblox film: $0.076 of GLM and Qwen calls
    expect(creditsFor(0.076)).toBe(28);
  });

  it("price a video by the model writing it: a cheap model makes a cheap video", () => {
    const glm = videoPrice(GLM, 25);
    const opus = videoPrice(OPUS, 25);
    expect(glm.estimate).toBeLessThan(100);
    expect(opus.estimate).toBeGreaterThan(10 * glm.estimate);
    // the hold covers a heavier run than usual
    expect(glm.hold).toBeGreaterThan(glm.estimate);
    expect(videoPrice(GLM, 60).estimate).toBeGreaterThan(glm.estimate);
  });

  it("charge what was used plus the fee, never more than held", () => {
    expect(meteredCredits(0.076, 300, VIDEO_FEE)).toBe(VIDEO_FEE + 28);
    expect(meteredCredits(10, 300, VIDEO_FEE)).toBe(300);
    // a change costs at least the minimum
    expect(meteredCredits(0, 50)).toBe(MIN_CHANGE);
  });

  it("price a scene rewrite per model, at least the minimum", () => {
    expect(changePrice(0).estimate).toBe(MIN_CHANGE);
    expect(changePrice(sceneUsd(OPUS)).estimate).toBeGreaterThan(changePrice(sceneUsd(GLM)).estimate * 5);
  });

  it("meter a model with no price as an expensive one", () => {
    expect(videoPrice({ ...GLM, coder: "mystery-model" }, 25).estimate).toBeGreaterThan(videoPrice(GLM, 25).estimate * 10);
  });
});

describe("narration", () => {
  it("is priced at ElevenLabs' ceiling ($6 for 30k characters) and added to a narrated video's price", async () => {
    const { narrationUsd, videoPrice, creditsFor } = await import("./meter");
    // 30 s at ~20 characters a second, $0.20 per 1,000 characters
    expect(narrationUsd(30)).toBeCloseTo(0.12, 6);
    const plain = videoPrice({ coder: "claude-haiku-5-5" }, 30).estimate;
    const voiced = videoPrice({ coder: "claude-haiku-5-5", narration: true }, 30).estimate;
    expect(voiced - plain).toBeGreaterThanOrEqual(creditsFor(0.12) - 1);
    expect(voiced - plain).toBeLessThanOrEqual(creditsFor(0.12) + 1);
  });
});
