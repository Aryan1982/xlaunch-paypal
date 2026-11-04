import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Account } from "../auth";
import type { Project } from "../types";

/** A video's credits after its jobs: metered on delivery or stop, refunded on failure. */

const projects = new Map<string, Project>();
const refunds: string[] = [];
const parts: Array<[string, number]> = [];
const charges: number[] = [];
/** The project's running model cost: a job's `run` raises it, as its calls would. */
let usd = 0;

vi.mock("../store", () => ({
  getProject: async (id: string) => projects.get(id)!,
  updateProject: async (id: string, fn: (p: Project) => void) => {
    fn(projects.get(id)!);
    return projects.get(id)!;
  },
}));
vi.mock("./credits", () => ({
  billingEnabled: () => true,
  newRef: (kind: string, id: string) => `${kind}:${id}:new`,
  charge: async (_a: Account, credits: number, _r: string, _p: string, ref: string) => {
    charges.push(credits);
    return { ref, credits };
  },
  chargeUpTo: async (_a: Account, credits: number, _l: number, _r: string, _p: string, ref: string) => {
    charges.push(credits);
    return { ref, credits };
  },
  refund: async (held: { ref: string }) => {
    refunds.push(held.ref);
    return true;
  },
  refundPart: async (held: { ref: string }, credits: number) => {
    if (credits > 0) parts.push([held.ref, credits]);
    return Math.max(0, credits);
  },
}));
vi.mock("./meter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./meter")>()),
  projectUsd: () => usd,
}));

const { ensureVideoCharge, settleVideo } = await import("./jobs");

describe("a free preview", () => {
  it("can't go on to the video without paying: continuing it holds the video's credits", async () => {
    charges.length = 0;
    projects.set("pv", { id: "pv", stage: "preview", options: { length: 30, freePreview: true }, scenes: [], chat: [] } as unknown as Project);
    await ensureVideoCharge({ id: "u1", isAdmin: false } as Account, "pv");
    expect(charges).toHaveLength(1);
    expect(projects.get("pv")!.charge?.state).toBe("held");
  });
});
const { creditsFor, VIDEO_FEE } = await import("./meter");

const HELD = 300;
const video = (patch: Partial<Project>): Project =>
  ({ id: "v1", stage: "ready", options: { length: 25 }, charge: { ref: "video:v1:a", credits: HELD, state: "held", usd: 0 }, ...patch }) as Project;
const account = { id: "u1", isAdmin: false } as Account;
/** A job whose model calls cost `cost`. */
const job = (cost: number) => async () => {
  usd += cost;
};

describe("a video's credits after its jobs", () => {
  beforeEach(() => {
    refunds.length = 0;
    parts.length = 0;
    charges.length = 0;
    usd = 0;
  });

  it("charge what the video's model calls cost, plus the fee, and give the rest of the hold back", async () => {
    projects.set("v1", video({ stage: "ready" }));
    await settleVideo("v1", job(0.1));
    const used = VIDEO_FEE + creditsFor(0.1);
    expect(projects.get("v1")!.charge).toMatchObject({ state: "delivered", charged: used });
    expect(parts).toEqual([["video:v1:a", HELD - used]]);
  });

  it("add up a video's cost across its jobs (it pauses at the brief, then finishes)", async () => {
    projects.set("v1", video({ stage: "brief" }));
    await settleVideo("v1", job(0.05));
    expect(projects.get("v1")!.charge).toMatchObject({ state: "held", usd: 0.05 });
    projects.get("v1")!.stage = "ready";
    await settleVideo("v1", job(0.05));
    expect(projects.get("v1")!.charge!.charged).toBe(VIDEO_FEE + creditsFor(0.1));
  });

  it("never charge more than was held", async () => {
    projects.set("v1", video({ stage: "ready" }));
    await settleVideo("v1", job(50));
    expect(projects.get("v1")!.charge!.charged).toBe(HELD);
    expect(parts).toEqual([]);
  });

  it("are refunded in full when the video fails", async () => {
    projects.set("v1", video({ stage: "error" }));
    await settleVideo("v1", job(0.2));
    expect(projects.get("v1")!.charge).toMatchObject({ state: "refunded", charged: 0 });
    expect(refunds).toEqual(["video:v1:a"]);
  });

  it("charge what a stopped video used, and Retry holds again", async () => {
    projects.set("v1", video({ stage: "error", stopped: true }));
    await settleVideo("v1", job(0.02));
    expect(projects.get("v1")!.charge).toMatchObject({ state: "spent", charged: VIDEO_FEE + creditsFor(0.02) });
    expect(refunds).toEqual([]);

    await ensureVideoCharge(account, "v1");
    expect(charges).toHaveLength(1);
    expect(projects.get("v1")!.charge).toMatchObject({ state: "held", usd: 0 });
  });
});
