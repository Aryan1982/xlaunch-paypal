import fs from "fs";
import os from "os";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Project } from "../types";

/** Stopping an export: the film's renderer is faked, and its render only ends when cancelled or let through. */

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xl-render-"));
fs.mkdirSync(path.join(dir, "src"), { recursive: true });
const projects = new Map<string, Project>();
let finish: (() => void) | null = null;
let rendering = false;

vi.mock("../store", () => ({
  getProject: async (id: string) => projects.get(id)!,
  updateProject: async (id: string, fn: (p: Project) => void) => {
    fn(projects.get(id)!);
    return projects.get(id)!;
  },
  projectDir: () => dir,
  rendersDir: () => path.join(dir, "renders"),
}));
vi.mock("../workdir", () => ({ ensureWorkdir: async () => undefined, storeRender: async () => null, dropRenders: async () => undefined }));
vi.mock("./motion-agent", () => ({
  renderMotion: (_id: string, _out: string, _progress: unknown, signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      rendering = true;
      finish = resolve;
      signal.addEventListener("abort", () => reject(new Error("render cancelled")));
    }),
}));

const { runRender, stopRender } = await import("./render");

const ID = "rendertest";

describe("stopping an export", () => {
  beforeEach(() => {
    projects.set(ID, { id: ID, stage: "ready", userId: "u1", options: { mode: "motion" }, render: { state: "idle", progress: 0 } } as unknown as Project);
    finish = null;
    rendering = false;
  });

  it("cancels the render and goes back to ready to export, marked stopped", async () => {
    const job = runRender(ID);
    await vi.waitFor(() => expect(rendering).toBe(true));
    expect(stopRender(ID)).toBe(true);
    await job;
    expect(projects.get(ID)!.render).toEqual({ state: "idle", progress: 0, stopped: true });
    expect(stopRender(ID)).toBe(false);
  });

  it("finishes normally when nobody stops it", async () => {
    const job = runRender(ID);
    await vi.waitFor(() => expect(rendering).toBe(true));
    finish!();
    await job;
    expect(projects.get(ID)!.render.state).toBe("done");
    expect(projects.get(ID)!.render.stopped).toBeUndefined();
  });

  it("has nothing to stop when no export runs", () => {
    expect(stopRender(ID)).toBe(false);
  });
});
