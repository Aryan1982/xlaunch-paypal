import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Charge } from "../billing/credits";
import type { Project } from "../types";

/**
 * Chat changes to a film are priced as a typical film revision: the film
 * agent is faked, the store is in memory, and the agent's run is the only
 * "work" applied.
 */

const projects = new Map<string, Project>();
let applyFails = false;
/** Set to hold the change being applied, until the test lets it go. */
let gate: Promise<void> | null = null;
let reached = false;
const requests: string[] = [];

vi.mock("../store", async (importOriginal) => {
  const real = await importOriginal<typeof import("../store")>();
  const update = async (id: string, fn: (p: Project) => void) => {
    const p = projects.get(id)!;
    fn(p);
    return p;
  };
  return {
    ...real,
    getProject: async (id: string) => projects.get(id)!,
    updateProject: update,
    say: (id: string, text: string, role = "assistant", kind = "status") =>
      update(id, (p) => {
        p.chat.push({ role, text, kind, at: Date.now() } as Project["chat"][number]);
      }),
    log: async () => undefined,
    setActivity: (id: string, activity: string, stage: Project["stage"]) =>
      update(id, (p) => {
        p.activity = activity;
        p.stage = stage;
      }),
  };
});
/** Like a real agent run: wait, then fail if the job was stopped meanwhile. */
vi.mock("./motion-agent", () => ({
  attachToFilm: () => [],
  workspaceOf: () => "",
  runMotionAgent: async (_id: string, run: { request?: string }, onBuilt: () => Promise<void>) => {
    reached = true;
    if (gate) await gate;
    const { stopRequested, Stopped } = await import("../lib/calls");
    if (stopRequested()) throw new Stopped();
    if (applyFails) throw new Error("disk full");
    requests.push(run.request ?? "");
    await onBuilt();
  },
}));
vi.mock("../workdir", () => ({ ensureWorkdir: async () => undefined, syncProject: async () => undefined }));

/** The models the test project runs on: cheap by default, Opus to make a change cost enough to ask first. */
const HAIKU = { coder: "claude-haiku-5-5", motion: true };
const OPUS = { coder: "claude-opus-5-5", motion: true };
let models = HAIKU;
vi.mock("../billing/jobs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../billing/jobs")>()),
  modelsOf: () => models,
}));

const { runChat, confirmChat, cancelChat, stopJob, STOPPED_MESSAGE } = await import("./index");
const { changePrice, MIN_CHANGE, motionUsd } = await import("../billing/meter");
const { setPrices } = await import("../usage/prices");
setPrices({
  // priced low here so a change stays under the ask line
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-opus-5-5": { input: 4, output: 20 },
});

const ID = "chattest";
const project = (): Project =>
  ({
    id: ID,
    userId: "u1",
    stage: "ready",
    activity: "",
    options: { prompt: "", notes: "", length: 30, mode: "motion" },
    motionAgent: { runs: 1, frames: [] },
    scenes: [],
    chat: [],
    log: [],
    version: 1,
    render: { state: "idle", progress: 0 },
    audio: { music: { enabled: true, volume: 0.5 }, sfx: { enabled: true, volume: 0.5 } },
    createdAt: 0,
    updatedAt: 0,
  }) as unknown as Project;

const wallet = () => {
  const charged: number[] = [];
  const refunded: number[] = [];
  /** Unused parts of holds given back. */
  const returned: number[] = [];
  return {
    charged,
    refunded,
    returned,
    pay: {
      refundPart: async (_held: Charge, credits: number) => {
        if (credits > 0) returned.push(credits);
        return Math.max(0, credits);
      },
      charges: true,
      charge: async (credits: number): Promise<Charge> => {
        charged.push(credits);
        return { ref: `r${charged.length}`, credits };
      },
      refund: async (held: Charge | null) => {
        if (held) refunded.push(held.credits);
      },
    },
  };
};

const lastReply = () => projects.get(ID)!.chat.at(-1)!.text;

describe("chat changes to a film are metered", () => {
  beforeEach(() => {
    models = HAIKU;
    projects.set(ID, project());
    applyFails = false;
    gate = null;
    reached = false;
    requests.length = 0;
  });

  it("hands the request to the film's agent at once when it is cheap, and charges what it used", async () => {
    const w = wallet();
    const price = changePrice(motionUsd(HAIKU));
    expect(price.estimate).toBeLessThanOrEqual(80);
    await runChat(ID, "make the logo bigger", w.pay);
    expect(requests).toEqual(["make the logo bigger"]);
    expect(w.charged).toEqual([price.hold]);
    // its calls cost nothing here, so all but the minimum comes back
    expect(w.returned).toEqual([price.hold - MIN_CHANGE]);
    expect(projects.get(ID)!.stage).toBe("ready");
  });

  it("asks first when the model makes it expensive", async () => {
    const w = wallet();
    models = OPUS;
    const opus = changePrice(motionUsd(OPUS));
    expect(opus.estimate).toBeGreaterThan(80);
    await runChat(ID, "redo it darker", w.pay);
    expect(w.charged).toEqual([]);
    expect(requests).toEqual([]);
    const pending = projects.get(ID)!.pendingChange!;
    expect(pending).toMatchObject({ credits: opus.hold, estimate: opus.estimate, summary: "revises the film" });
    expect(lastReply()).toMatch(new RegExp(`about ${opus.estimate.toLocaleString("en-US")} credits.*Confirm`));

    await cancelChat(ID);
    expect(projects.get(ID)!.pendingChange).toBeUndefined();
  });

  it("applies a held change when confirmed: holds the quote, charges what it used", async () => {
    const w = wallet();
    projects.get(ID)!.pendingChange = {
      actions: [{ type: "revise_motion", instruction: "louder" }],
      credits: 120,
      estimate: 50,
      message: "louder",
      summary: "revises the film",
      at: Date.now(),
    };
    await confirmChat(ID, w.pay);
    expect(requests).toEqual(["louder"]);
    expect(w.charged).toEqual([120]);
    expect(projects.get(ID)!.pendingChange).toBeUndefined();
  });

  it("refuses an expired confirmation without charging", async () => {
    const w = wallet();
    projects.get(ID)!.pendingChange = { actions: [], credits: 340, message: "x", summary: "s", at: Date.now() - 31 * 60_000 };
    await confirmChat(ID, w.pay);
    expect(w.charged).toEqual([]);
    expect(lastReply()).toMatch(/expired/);
  });

  it("refunds when applying fails, and keeps the video", async () => {
    const w = wallet();
    applyFails = true;
    const price = changePrice(motionUsd(HAIKU));
    await runChat(ID, "quieter", w.pay);
    expect(w.charged).toEqual([price.hold]);
    expect(w.refunded).toEqual([price.hold]);
    expect(projects.get(ID)!.stage).toBe("ready");
    expect(lastReply()).toMatch(new RegExp(`${price.hold} credits are back`));
  });

  it("says so, without applying, when the balance is short", async () => {
    const w = wallet();
    w.pay.charge = async () => {
      throw new Error("This needs 30 credits and you have 0.");
    };
    await runChat(ID, "quieter", w.pay);
    expect(requests).toEqual([]);
    expect(lastReply()).toMatch(/needs 30 credits.*Credits page/);
  });

  it("never asks or charges when the caller doesn't pay", async () => {
    const w = wallet();
    w.pay.charges = false;
    models = OPUS;
    await runChat(ID, "quieter", w.pay);
    expect(w.charged).toEqual([]);
    expect(projects.get(ID)!.pendingChange).toBeUndefined();
    expect(lastReply()).toBe("Done — the preview is updated.");
  });

  it("stopping while a change is applied keeps its credits and ends stopped", async () => {
    const w = wallet();
    let go!: () => void;
    gate = new Promise((r) => (go = r));
    const job = runChat(ID, "quieter", w.pay);
    // the change is paid for; the agent's run is held
    await vi.waitFor(() => expect(reached).toBe(true));
    expect(w.charged).toHaveLength(1);
    expect(stopJob(ID)).toBe(true);
    go();
    await job;
    expect(w.refunded).toEqual([]);
    const p = projects.get(ID)!;
    expect(p.stage).toBe("error");
    expect(p.stopped).toBe(true);
    expect(p.error).toBe(STOPPED_MESSAGE);
  });

  it("has nothing to stop when no job runs", () => {
    expect(stopJob(ID)).toBe(false);
  });
});
