import { afterEach, describe, expect, it, vi } from "vitest";

import type { Account } from "../auth";

// local mode: the same rules, kept in memory
vi.mock("../db", () => ({ db: () => ({}), dbEnabled: () => false, must: (r: unknown) => r }));

const { claimPreview, clientIp, freePreviewsLeft, previewOf, PREVIEWS_PER_IP_PER_DAY } = await import("./preview");
const user = (id: string) => ({ id, email: `${id}@x.com` }) as Account;

// the daily cap has its own test, on its own days
vi.stubEnv("FREE_PREVIEWS_PER_DAY", "1000");

describe("free previews", () => {
  it("one per account, for good", async () => {
    expect(await claimPreview(user("a"), "p1", "1.1.1.1")).toBe("claimed");
    expect(await claimPreview(user("a"), "p2", "2.2.2.2")).toBe("refused");
    // the used preview is found again, to point the user back to it
    expect(await previewOf(user("a"))).toBe("p1");
    expect(await previewOf(user("nobody"))).toBeNull();
  });

  it("a few per IP a day, against throwaway sign-ups", async () => {
    const ip = "9.9.9.9";
    const results: string[] = [];
    for (let i = 0; i < PREVIEWS_PER_IP_PER_DAY + 2; i++) results.push(await claimPreview(user(`ip-${i}`), `p${i}`, ip));
    expect(results.filter((r) => r === "claimed")).toHaveLength(PREVIEWS_PER_IP_PER_DAY);
    expect(results.slice(-2)).toEqual(["refused", "refused"]);
  });

  it("reads the client's address from nginx's X-Real-IP, else the socket", () => {
    expect(clientIp({ "x-real-ip": "5.6.7.8" }, "127.0.0.1")).toBe("5.6.7.8");
    expect(clientIp({}, "127.0.0.1")).toBe("127.0.0.1");
  });

  it("trusts a web app's forwarded visitor address only with the proxy secret", () => {
    vi.stubEnv("PROXY_SECRET", "s3cret");
    const forwarded = { "x-xlaunch-client-ip": "8.8.4.4", "x-real-ip": "76.76.21.21" };
    expect(clientIp({ ...forwarded, "x-xlaunch-proxy-secret": "s3cret" }, "127.0.0.1")).toBe("8.8.4.4");
    // a visitor calling the API directly can't pick their own address
    expect(clientIp({ ...forwarded, "x-xlaunch-proxy-secret": "guess" }, "127.0.0.1")).toBe("76.76.21.21");
    expect(clientIp(forwarded, "127.0.0.1")).toBe("76.76.21.21");
    vi.stubEnv("PROXY_SECRET", "");
    expect(clientIp({ ...forwarded, "x-xlaunch-proxy-secret": "" }, "127.0.0.1")).toBe("76.76.21.21");
  });

  it("an account allowed unlimited previews gets one every time, past the IP limit too", async () => {
    const tester = { ...user("tester"), unlimitedPreviews: true } as Account;
    const ip = "7.7.7.7";
    for (let i = 0; i < PREVIEWS_PER_IP_PER_DAY; i++) await claimPreview(user(`fill-${i}`), `f${i}`, ip);
    const results: string[] = [];
    for (let i = 0; i < 5; i++) results.push(await claimPreview(tester, `t${i}`, ip));
    expect(results).toEqual(["claimed", "claimed", "claimed", "claimed", "claimed"]);
    // the record points at the latest one
    expect(await previewOf(tester)).toBe("t4");
  });
});

describe("the daily cap across all users", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.stubEnv("FREE_PREVIEWS_PER_DAY", "1000");
  });

  it("is FREE_PREVIEWS_PER_DAY a UTC day, not counting unlimited accounts, and opens again at 00:00 UTC", async () => {
    vi.stubEnv("FREE_PREVIEWS_PER_DAY", "3");
    vi.useFakeTimers({ toFake: ["Date"] });
    // late on a UTC day far from the other tests' days
    vi.setSystemTime(new Date("2030-01-01T23:58:00Z"));
    expect(await freePreviewsLeft()).toBe(3);
    const unlimited = { ...user("cap-team"), unlimitedPreviews: true } as Account;
    expect(await claimPreview(unlimited, "u1", "10.0.0.100")).toBe("claimed");
    const day1: string[] = [];
    for (let i = 0; i < 4; i++) day1.push(await claimPreview(user(`cap-${i}`), `c${i}`, `10.0.0.${i}`));
    expect(day1).toEqual(["claimed", "claimed", "claimed", "full"]);
    expect(await freePreviewsLeft()).toBe(0);
    // the unlimited account still gets its own
    expect(await claimPreview(unlimited, "u2", "10.0.0.100")).toBe("claimed");
    // the one turned away kept no claim
    expect(await previewOf(user("cap-3"))).toBeNull();

    vi.setSystemTime(new Date("2030-01-02T00:01:00Z"));
    expect(await freePreviewsLeft()).toBe(3);
    expect(await claimPreview(user("cap-3"), "c3", "10.0.1.3")).toBe("claimed");
  });
});
