import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Account } from "../auth";

/** A dearer model starts on a smaller balance: the whole balance is held when it covers the typical cost. */

let balance = 0;
const spends: number[] = [];

vi.mock("../db", () => ({
  db: () => ({
    rpc: async (_fn: string, args: { p_amount: number }) => {
      if (args.p_amount > balance) return { data: { ok: false, balance }, error: null };
      balance -= args.p_amount;
      spends.push(args.p_amount);
      return { data: { ok: true, balance }, error: null };
    },
  }),
  must: (r: { data: unknown; error: unknown }) => r.data,
  dbEnabled: () => true,
}));
vi.stubEnv("DODO_PAYMENTS_API_KEY", "test");

const credits = await import("./credits");
const account = { id: "u1", isAdmin: false } as Account;

describe("holding credits for work", () => {
  beforeEach(() => {
    spends.length = 0;
  });

  it("holds the full amount when the balance has it", async () => {
    balance = 5000;
    expect(await credits.chargeUpTo(account, 3048, 1234, "video", "p1", "video:p1:a")).toEqual({ ref: "video:p1:a", credits: 3048 });
  });

  it("holds the whole balance when it is short of the hold but covers the typical cost (Opus on the Launch plan)", async () => {
    balance = 2500;
    expect(await credits.chargeUpTo(account, 3048, 1234, "video", "p1", "video:p1:b")).toEqual({ ref: "video:p1:b", credits: 2500 });
    expect(balance).toBe(0);
  });

  it("refuses below the typical cost, saying what starting needs", async () => {
    balance = 1000;
    await expect(credits.chargeUpTo(account, 3048, 1234, "video", "p1", "video:p1:c")).rejects.toMatchObject({ status: 402, details: { code: "credits", needed: 1234, balance: 1000 } });
    expect(spends).toEqual([]);
  });
});
