import { describe, expect, it } from "vitest";

import type { Project } from "../types";
import { FEED_CAP, closeFeed, dropSummary, parseStills, pushFeed, settleFeed } from "./feed";

const project = (): Project => ({ feed: [] }) as unknown as Project;
const running = { status: "running" as const, open: 1 };

describe("parseStills", () => {
  it("reads the frames from the stills tool and from npm's output around them", () => {
    const out = ["", "> film@1.0.0 stills", "> node scripts/stills.mjs 0 120", "", "frame 0 (0.00s) -> review/r03/f0000.jpg", "frame 120 (4.00s) -> review/r03/f0120.jpg\r", "Contact sheet review/r03/sheet.jpg"].join("\n");
    expect(parseStills(out)).toEqual([
      { frame: 0, seconds: 0, round: "r03", file: "f0000.jpg" },
      { frame: 120, seconds: 4, round: "r03", file: "f0120.jpg" },
    ]);
  });

  it("finds nothing in output that only mentions frames", () => {
    expect(parseStills("Rendering frame 12 failed: review/r01/f0012.jpg missing")).toEqual([]);
  });
});

describe("pushFeed", () => {
  it("counts consecutive work on the same thing on one entry, reopening it", () => {
    const p = project();
    const first = pushFeed(p, 1, { kind: "step", label: "Animating the inbox scene", icon: "code", ...running }, 10);
    settleFeed(p, first.id, { error: false, output: "ok" }, 20);
    const again = pushFeed(p, 1, { kind: "step", label: "Animating the inbox scene", icon: "code", ...running }, 30);
    expect(again.id).toBe(first.id);
    expect(p.feed).toHaveLength(1);
    expect(p.feed![0]).toMatchObject({ count: 2, status: "running", open: 1, at: 10 });
    expect(p.feed![0]).not.toHaveProperty("end");
  });

  it("starts a new entry after a thought, in another run, or after a failure", () => {
    const p = project();
    const step = { kind: "step" as const, label: "Reading the code", icon: "file" as const, ...running };
    pushFeed(p, 1, step);
    pushFeed(p, 1, { kind: "thought", text: "Now the end." });
    pushFeed(p, 1, step);
    pushFeed(p, 2, step);
    const failed = pushFeed(p, 2, { ...step, label: "Animating the end scene" });
    settleFeed(p, failed.id, { error: true, output: "<tool_use_error>String to replace not found in file.</tool_use_error>" });
    pushFeed(p, 2, { ...step, label: "Animating the end scene" });
    expect(p.feed!.map((i) => i.kind)).toEqual(["step", "thought", "step", "step", "step", "step"]);
    expect(p.feed![4]).toMatchObject({ status: "error", detail: "String to replace not found in file." });
  });

  it("keeps only the newest FEED_CAP entries", () => {
    const p = project();
    for (let i = 0; i < FEED_CAP + 5; i++) pushFeed(p, 1, { kind: "thought", text: String(i) });
    expect(p.feed).toHaveLength(FEED_CAP);
    expect(p.feed![0]).toMatchObject({ text: "5" });
  });
});

describe("settleFeed", () => {
  it("is done only once every call counted on the entry is back", () => {
    const p = project();
    const a = pushFeed(p, 1, { kind: "step", label: "Inspecting the frames", icon: "look", ...running });
    pushFeed(p, 1, { kind: "step", label: "Inspecting the frames", icon: "look", ...running });
    settleFeed(p, a.id, { error: false, output: "" }, 50);
    expect(p.feed![0]).toMatchObject({ status: "running", open: 1 });
    settleFeed(p, a.id, { error: false, output: "" }, 60);
    expect(p.feed![0]).toMatchObject({ status: "done", end: 60 });
    expect(p.feed![0]).not.toHaveProperty("open");
  });

  it("fails a check whose output has type errors, though the tool did not fail", () => {
    const p = project();
    const check = pushFeed(p, 1, { kind: "check", label: "Checking the film for errors", ...running });
    settleFeed(p, check.id, { error: false, output: "src/Video.tsx(3,1): error TS2304: Cannot find name 'x'.\nsrc/Video.tsx(4,1): error TS2304: Cannot find name 'y'." });
    expect(p.feed![0]).toMatchObject({ status: "error", detail: "2 type errors: src/Video.tsx(3,1): error TS2304: Cannot find name 'x'." });
    const clean = pushFeed(p, 1, { kind: "check", label: "Checking the film for errors", ...running });
    settleFeed(p, clean.id, { error: false, output: "No errors." });
    expect(p.feed![1]).toMatchObject({ status: "done" });
  });

  it("gives a stills round the frames it rendered", () => {
    const p = project();
    const stills = pushFeed(p, 1, { kind: "stills", label: "Rendering frames to review", frames: [], ...running });
    settleFeed(p, stills.id, { error: false, output: "frame 60 (2.00s) -> review/r01/f0060.jpg" });
    expect(p.feed![0]).toMatchObject({ status: "done", frames: [{ frame: 60, seconds: 2, round: "r01", file: "f0060.jpg" }] });
  });
});

describe("closeFeed and dropSummary", () => {
  it("ends only the run's entries still running", () => {
    const p = project();
    const done = pushFeed(p, 1, { kind: "check", label: "Final check", ...running });
    settleFeed(p, done.id, { error: false, output: "" });
    pushFeed(p, 1, { kind: "step", label: "Reading the code", icon: "file", ...running });
    pushFeed(p, 2, { kind: "step", label: "Reading the code", icon: "file", ...running });
    closeFeed(p, 1, "stopped", 99);
    expect(p.feed!.map((i) => ("status" in i ? i.status : null))).toEqual(["done", "stopped", "running"]);
  });

  it("drops the closing summary, which the chat shows as the reply", () => {
    const p = project();
    pushFeed(p, 1, { kind: "thought", text: "Plan first." });
    pushFeed(p, 1, { kind: "thought", text: "The film is ready." });
    dropSummary(p, 1, "  The film is ready.\n");
    dropSummary(p, 1, "Something else");
    expect(p.feed!.map((i) => (i.kind === "thought" ? i.text : ""))).toEqual(["Plan first."]);
  });
});
