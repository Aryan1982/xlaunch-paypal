import { describe, expect, it } from "vitest";

import { abandonedCheckouts, followUpEmail, giftEmail, paywallEmail, paywallReminders } from "./followup";

describe("the preview follow-up email", () => {
  it("names the product, links back, says the deadline, and says it's the only one", () => {
    const m = followUpEmail({ product: "Acme <b>", link: "https://xlaunch.pro/p/abc", offerEnds: "2026-11-15" });
    expect(m.subject).toBe("Your launch film for Acme <b> is planned");
    expect(m.html).toContain("Acme &lt;b&gt;");
    expect(m.html).not.toContain("Acme <b>");
    expect(m.html).toContain('href="https://xlaunch.pro/p/abc"');
    expect(m.text).toContain("November 15");
    expect(m.text).toMatch(/at most one reminder/);
  });
});

describe("unfinished checkouts to follow up", () => {
  const now = Date.parse("2026-10-15T12:00:00Z");
  const ago = (h: number) => new Date(now - h * 3_600_000).toISOString();
  const row = (event: string, user: string, hoursAgo: number, project: string | null = null) => ({ event, user_id: user, project_id: project, at: ago(hoursAgo) });

  it("takes checkouts left 1-48 hours, the latest per account, unless paid since or already emailed", () => {
    const due = abandonedCheckouts(
      [
        row("checkout_started", "left", 3, "p-old"),
        row("checkout_started", "left", 2, "p-new"),
        row("checkout_started", "paid-after", 3),
        row("paid", "paid-after", 2.5),
        // paid for something earlier, then opened another checkout and left it
        row("paid", "paid-before", 10),
        row("checkout_started", "paid-before", 5),
        row("checkout_started", "emailed", 5),
        row("checkout_email_sent", "emailed", 100),
        row("checkout_started", "too-soon", 0.5),
        row("checkout_started", "too-old", 49),
      ],
      now
    );
    expect(due).toEqual([
      { userId: "left", projectId: "p-new" },
      { userId: "paid-before", projectId: null },
    ]);
  });

  it("a newer checkout still within the hour holds back the email", () => {
    expect(abandonedCheckouts([row("checkout_started", "u", 3), row("checkout_started", "u", 0.2)], now)).toEqual([]);
  });

  it("skips accounts already sent the paywall reminder: the preview email promises at most one", () => {
    expect(abandonedCheckouts([row("checkout_started", "u", 3), row("paywall_email_sent", "u", 30)], now)).toEqual([]);
  });
});

describe("paywalls left without a checkout", () => {
  const now = Date.parse("2026-10-15T12:00:00Z");
  const ago = (h: number) => new Date(now - h * 3_600_000).toISOString();
  const row = (event: string, user: string, hoursAgo: number, project: string | null = "p") => ({ event, user_id: user, project_id: project, at: ago(hoursAgo) });
  const none = new Set<string>();

  it("takes paywalls seen 24-72 hours ago, the latest per account", () => {
    const due = paywallReminders([row("paywall_viewed", "u", 40, "p-old"), row("paywall_viewed", "u", 30, "p-new"), row("paywall_viewed", "fresh", 23), row("paywall_viewed", "stale", 73)], none, now);
    expect(due).toEqual([{ userId: "u", projectId: "p-new" }]);
  });

  it("a newer view within the day holds it back", () => {
    expect(paywallReminders([row("paywall_viewed", "u", 30), row("paywall_viewed", "u", 2)], none, now)).toEqual([]);
  });

  it("skips accounts that started a checkout or paid since their first view", () => {
    const due = paywallReminders(
      [
        row("paywall_viewed", "checkout", 30),
        row("checkout_started", "checkout", 29, null),
        row("paywall_viewed", "paid", 50),
        row("paid", "paid", 45, null),
        // came back to the paywall after the checkout: the checkout email covers it
        row("paywall_viewed", "back", 60),
        row("checkout_started", "back", 55, null),
        row("paywall_viewed", "back", 30),
        // a checkout before the paywall was ever seen doesn't count
        row("checkout_started", "earlier", 70, null),
        row("paywall_viewed", "earlier", 30),
      ],
      none,
      now
    );
    expect(due).toEqual([{ userId: "earlier", projectId: "p" }]);
  });

  it("never emails twice, an admin, or a view without a project", () => {
    const due = paywallReminders(
      [row("paywall_viewed", "emailed", 30), row("paywall_email_sent", "emailed", 200), row("paywall_viewed", "admin", 30), row("paywall_viewed", "noproject", 30, null), row("paywall_viewed", "ok", 30)],
      new Set(["admin"]),
      now
    );
    expect(due).toEqual([{ userId: "ok", projectId: "p" }]);
  });
});

describe("the paywall reminder email", () => {
  it("names the film, says the plan and opening are ready, the price, the guarantee, and links back", () => {
    const m = paywallEmail({ product: "Acme <b>", link: "https://xlaunch.pro/p/abc", price: "$9", guarantee: true });
    expect(m.subject).toBe("Your launch film for Acme <b> is ready to finish");
    expect(m.html).toContain("Acme &lt;b&gt;");
    expect(m.html).not.toContain("Acme <b>");
    expect(m.text).toContain("Your launch film for Acme <b> is planned, and its opening is already built.");
    expect(m.text).toContain("$9 with the One video pack");
    expect(m.text).toContain("First-purchase guarantee");
    expect(m.text).toContain("fewer than half of its credits");
    expect(m.html).toContain('href="https://xlaunch.pro/p/abc"');
  });

  it("leaves the price out when the pack isn't on sale or doesn't cover the film", () => {
    expect(paywallEmail({ product: "Acme", link: "https://xlaunch.pro/p/abc", price: null, guarantee: true }).text).not.toContain("$");
  });

  it("leaves the guarantee out for an account that has already bought", () => {
    const m = paywallEmail({ product: "Acme", link: "https://xlaunch.pro/p/abc", price: "$9", guarantee: false });
    expect(m.text).not.toContain("First-purchase guarantee");
    expect(m.html).not.toContain("First-purchase guarantee");
  });
});

describe("the gift email", () => {
  it("says it's finished on us, links to it, and asks for a line back", () => {
    const m = giftEmail({ host: "acme.com", link: "https://xlaunch.pro/p/abc" });
    expect(m.subject).toBe("Your launch film for acme.com is finished, on us");
    expect(m.html).toContain('href="https://xlaunch.pro/p/abc"');
    expect(m.text).toMatch(/reply with one line of honest feedback/);
  });
});
