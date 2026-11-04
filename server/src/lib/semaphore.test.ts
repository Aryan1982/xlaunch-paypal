import { describe, expect, it } from "vitest";

import { Semaphore } from "./semaphore";

describe("Semaphore", () => {
  it("runs at most N at once, in arrival order, and reports the queue", async () => {
    const s = new Semaphore(1);
    const order: string[] = [];
    const ahead: Record<string, number[]> = { b: [], c: [] };
    const first = await s.acquire();
    const b = s.acquire((n) => ahead.b.push(n)).then((release) => (order.push("b"), release));
    const c = s.acquire((n) => ahead.c.push(n)).then((release) => (order.push("c"), release));
    expect(s.waiting).toBe(2);
    first();
    (await b)();
    (await c)();
    expect(order).toEqual(["b", "c"]);
    expect(ahead.b).toEqual([1, 0]);
    expect(ahead.c).toEqual([2, 1, 0]);
  });

  it("ignores a double release", async () => {
    const s = new Semaphore(1);
    const r = await s.acquire();
    r();
    r();
    const a = await s.acquire();
    let second = false;
    void s.acquire().then(() => (second = true));
    await Promise.resolve();
    expect(second).toBe(false);
    a();
  });
});
