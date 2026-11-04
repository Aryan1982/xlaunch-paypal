import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Account } from "./auth";
import { HttpError } from "./lib/http";
import { publicShare, sharedProject, shareProject, SHARE_TOKEN, unshareProject } from "./share";
import type * as Store from "./store";
import { DEFAULT_AUDIO, type Project } from "./types";

/** Share links: only the owner makes one, a wrong token opens nothing, and the public view carries nothing private. */

const projects = new Map<string, Project>();

// hoisted above the imports: share.ts reads projects from this in-memory store
vi.mock("./store", async (importOriginal) => ({
  ...(await importOriginal<typeof Store>()),
  getProject: async (id: string) => {
    const p = projects.get(id);
    if (!p) throw new HttpError(404, `Project "${id}" does not exist.`);
    return p;
  },
  updateProject: async (id: string, fn: (p: Project) => void) => {
    const p = projects.get(id)!;
    fn(p);
    return p;
  },
}));

const person = (id: string, isAdmin = false): Account => ({ id, email: `${id}@x.com`, plan: "free", isAdmin, videosPerMonth: 5, tokensPerMonth: 1, storageMb: 1 });
const owner = person("u1");

/** A film agent's free preview, with everything private filled in. */
const film = (): Project => ({
  id: "abc123",
  userId: owner.id,
  url: "https://www.acme.dev/pricing",
  title: "Acme",
  createdAt: 1,
  updatedAt: 2,
  stage: "preview",
  activity: "Preview ready",
  options: { prompt: "secret prompt https://acme.dev", notes: "private notes", length: 30, mode: "motion", aspect: "16:9", freePreview: true },
  motionAgent: {
    sessionId: "sess_private",
    runs: 1,
    plan: "PRIVATE PLAN",
    frames: [],
    summary: "private summary",
    cut: 12,
    costUsd: 1.23,
    found: { url: "https://acme.dev", siteName: "Acme Cloud", colors: [], fonts: [], images: [] },
  },
  scenes: [],
  version: 7,
  render: { state: "idle", progress: 0 },
  audio: structuredClone(DEFAULT_AUDIO),
  cuePlan: [],
  chat: [{ id: "m1", role: "user", text: "private chat", at: 1, kind: "prompt" }],
  log: [{ at: 1, level: "info", message: "private log" }],
  reasoning: "private reasoning",
});

beforeEach(() => {
  projects.clear();
  projects.set("abc123", film());
});

describe("making a share link", () => {
  it("gives the owner an unguessable token for the project, the same one every time", async () => {
    const token = await shareProject(owner, "abc123");
    expect(token).toMatch(SHARE_TOKEN);
    expect(token.startsWith("abc123-")).toBe(true);
    expect(await shareProject(owner, "abc123")).toBe(token);
    expect(projects.get("abc123")!.share?.token).toBe(token);
  });

  it("refuses anyone but the owner, admins included, and a deleted project", async () => {
    await expect(shareProject(person("u2"), "abc123")).rejects.toMatchObject({ status: 404 });
    await expect(shareProject(person("admin", true), "abc123")).rejects.toMatchObject({ status: 404 });
    await expect(unshareProject(person("u2"), "abc123")).rejects.toMatchObject({ status: 404 });
    projects.get("abc123")!.deletedAt = 3;
    await expect(shareProject(owner, "abc123")).rejects.toMatchObject({ status: 404 });
    expect(projects.get("abc123")!.share).toBeUndefined();
  });
});

describe("opening a share link", () => {
  it("opens the project for its token", async () => {
    const token = await shareProject(owner, "abc123");
    expect((await sharedProject(token)).id).toBe("abc123");
  });

  it("is 404 for an unknown, wrong, malformed or turned-off token", async () => {
    const token = await shareProject(owner, "abc123");
    const wrong = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
    for (const t of [wrong, "abc123", "abc123-short", "nope12-" + "A".repeat(24), "../etc-" + "A".repeat(24), ""]) {
      await expect(sharedProject(t)).rejects.toMatchObject({ status: 404 });
    }
    await unshareProject(owner, "abc123");
    await expect(sharedProject(token)).rejects.toMatchObject({ status: 404 });
    // sharing again makes a new token: the old link stays off
    const again = await shareProject(owner, "abc123");
    expect(again).not.toBe(token);
    await expect(sharedProject(token)).rejects.toMatchObject({ status: 404 });
  });

  it("is 404 once the owner deletes the project", async () => {
    const token = await shareProject(owner, "abc123");
    projects.get("abc123")!.deletedAt = 3;
    await expect(sharedProject(token)).rejects.toMatchObject({ status: 404 });
  });
});

describe("the public view", () => {
  it("has only what playing the preview needs", async () => {
    await shareProject(owner, "abc123");
    const view = publicShare(projects.get("abc123")!);
    expect(view).toEqual({
      title: "Acme Cloud",
      host: "acme.dev",
      aspect: "16:9",
      seconds: 30,
      version: 7,
      ready: true,
      preview: { cut: 12 },
    });
    const json = JSON.stringify(view);
    for (const secret of ["u1", "secret prompt", "private", "PRIVATE", "sess_", "abc123", projects.get("abc123")!.share!.token]) {
      expect(json).not.toContain(secret);
    }
  });

  it("has no preview part once the film is paid for", () => {
    const paid = film();
    paid.charge = { ref: "video:abc123:a", credits: 600, state: "delivered" };
    paid.stage = "ready";
    expect(publicShare(paid).preview).toBeNull();
  });
});
