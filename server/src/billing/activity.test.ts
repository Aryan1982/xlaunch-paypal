import { describe, expect, it } from "vitest";

import { toActivity } from "./activity";

const row = (id: number, kind: "grant" | "spend" | "refund" | "adjust", pack: number, reason: string, extra: { project_id?: string; dodo_ref?: string } = {}) => ({
  id,
  at: `2026-11-0${id}T10:00:00Z`,
  kind,
  sub_delta: 0,
  pack_delta: pack,
  reason,
  project_id: extra.project_id ?? null,
  dodo_ref: extra.dodo_ref ?? null,
});

describe("credit activity", () => {
  it("walks the balance back from now, newest first, and names packs, videos and PayPal orders", () => {
    const rows = [
      row(4, "refund", 200, "video failed", { project_id: "p2" }),
      row(3, "spend", -500, "video", { project_id: "p2" }),
      row(2, "spend", -300, "video", { project_id: "p1" }),
      row(1, "grant", 1400, "pack_single", { dodo_ref: "paypal:5O190127TN364715T" }),
    ];
    const out = toActivity(rows, 800, new Map([["p1", "Acme launch"]]));
    expect(out.map((r) => [r.kind, r.credits, r.balance])).toEqual([
      ["refund", 200, 800],
      ["spend", -500, 600],
      ["spend", -300, 1100],
      ["purchase", 1400, 1400],
    ]);
    expect(out[3]).toMatchObject({ description: "Single pack", paypalOrderId: "5O190127TN364715T" });
    expect(out[2]).toMatchObject({ description: "Video", projectTitle: "Acme launch" });
    // a video whose project is gone keeps its id, without a title
    expect(out[1]).toMatchObject({ projectId: "p2", projectTitle: null, paypalOrderId: null });
  });

  it("shows a refunded PayPal purchase as a refund, not an adjustment", () => {
    const [r] = toActivity([row(5, "adjust", -1400, "refund 98S11515Y9651825L", { dodo_ref: "paypal:89Y74960HS373792G" })], 0, new Map());
    expect(r).toMatchObject({ kind: "refund", description: "PayPal refund", credits: -1400 });
  });
});
