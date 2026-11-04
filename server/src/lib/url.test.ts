import { describe, expect, it } from "vitest";
import { extractUrl } from "./url";

describe("extractUrl", () => {
  it("finds a full URL and strips it from the notes", () => {
    const r = extractUrl("Make a launch video for https://linear.app/ — playful tone.");
    expect(r.url).toBe("https://linear.app/");
    expect(r.rest).toContain("playful tone");
    expect(r.rest).not.toContain("linear.app");
  });
  it("finds a bare domain", () => {
    expect(extractUrl("video for raycast.com please").url).toBe("raycast.com");
  });
  it("trims trailing punctuation", () => {
    expect(extractUrl("see https://vercel.com.").url).toBe("https://vercel.com");
  });
  it("returns null when there is none", () => {
    expect(extractUrl("make it playful").url).toBeNull();
  });
});
