import { config } from "../config";
import { db, dbEnabled, must } from "../db";
import { launchOfferEnds, productBySku, productIdFor } from "../billing/catalog";
import { balanceOf, hasPurchased } from "../billing/credits";
import { videoPriceOf } from "../billing/jobs";
import type { Project } from "../types";
import { getProject } from "../store";
import { isUnpaidPreview } from "../pipeline/index";

/**
 * Follow-up emails, sent with Resend (RESEND_API_KEY, from EMAIL_FROM, e.g.
 * hello@xlaunch.pro on a domain verified there); without both, nothing is sent.
 *
 * - A free preview that wasn't paid for: about two hours after it was made,
 *   once per account (free_previews.emailed_at, db/009).
 * - A checkout opened and not finished: about an hour after, once per account
 *   (a `checkout_email_sent` funnel row). A checkout for a preview shares that
 *   preview's email: whichever is due first is the only one sent.
 * - A paywall seen with no checkout started: about a day after, once per
 *   account (a `paywall_email_sent` funnel row), never to admins.
 */

const AFTER_MS = 2 * 3_600_000;
/** Too old to follow up: a preview from days ago gets no email. */
const UNTIL_MS = 48 * 3_600_000;
const EVERY_MS = 10 * 60_000;
/** A checkout not paid after this long is taken as left. */
const CHECKOUT_AFTER_MS = 3_600_000;
/** A paywall seen this long ago with no checkout since gets its reminder. */
const PAYWALL_AFTER_MS = 24 * 3_600_000;
/** Too old for the paywall reminder. */
const PAYWALL_UNTIL_MS = 72 * 3_600_000;
/** EMAIL_FROM is a bare address (the sign-in email setup reads it too): shown as "XLaunch <address>". */
const sender = (): string => {
  const from = (process.env.EMAIL_FROM ?? "").trim();
  return from.includes("<") ? from : `XLaunch <${from}>`;
};

const enabled = (): boolean => dbEnabled() && !!process.env.RESEND_API_KEY && !!process.env.EMAIL_FROM;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The email for a planned, unpaid preview: the whole film's storyboard, its opening built. */
export const followUpEmail = (p: { product: string; link: string; offerEnds: string | null }) => {
  const ends = p.offerEnds ? new Date(`${p.offerEnds}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" }) : null;
  const subject = `Your launch film for ${p.product} is planned`;
  const lead = `Your launch film for ${p.product} is planned: the storyboard for the whole film is ready, and its opening is already built.`;
  const footer = "You're getting this because you planned a video on XLaunch. We'll send at most one reminder after this.";
  const text = [lead, `\nFinish the whole film here: ${p.link}`, ends ? `\nLaunch prices are on until ${ends}.` : "", `\n${footer}`].join("\n");
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1f1f1e">
  <p style="font-size:16px;margin:0 0 12px">Your launch film for <b>${esc(p.product)}</b> is planned: the storyboard for the whole film is ready, and its opening is already built.</p>
  <p style="margin:24px 0"><a href="${esc(p.link)}" style="background:#1f1f1e;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600;display:inline-block">See your storyboard</a></p>
  ${ends ? `<p style="font-size:14px;color:#6b6b68">Launch prices are on until ${esc(ends)}.</p>` : ""}
  <p style="font-size:12px;color:#9d9d99;margin-top:32px">${esc(footer)}</p>
</div>`;
  return { subject, text, html };
};

/** Send one email with Resend (from EMAIL_FROM). Throws when Resend refuses it. */
export const sendEmail = async (to: string, mail: { subject: string; text: string; html: string }): Promise<void> => {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: sender(), to, ...mail }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
};

/** Email every preview that is due: unpaid, still a preview, 2-48 hours old, not emailed yet. Returns how many were sent. */
export const sendFollowUps = async (now = Date.now()): Promise<number> => {
  if (!enabled()) return 0;
  const rows = must(
    await db()
      .from("free_previews")
      .select("user_id, project_id")
      .is("emailed_at", null)
      .lte("created_at", new Date(now - AFTER_MS).toISOString())
      .gte("created_at", new Date(now - UNTIL_MS).toISOString())
      .limit(50),
    "previews to follow up"
  ) as Array<{ user_id: string; project_id: string }>;
  let sent = 0;
  for (const row of rows) {
    // claimed first, so a restart or a second pass never sends it twice
    must(await db().from("free_previews").update({ emailed_at: new Date(now).toISOString() }).eq("user_id", row.user_id), "mark follow-up");
    const project = await getProject(row.project_id).catch(() => null);
    if (!project || !isUnpaidPreview(project) || project.stage !== "preview") continue;
    const who = must(await db().from("user_plans").select("email").eq("user_id", row.user_id).maybeSingle(), "follow-up email") as { email?: string } | null;
    if (!who?.email) continue;
    try {
      await sendEmail(
        who.email,
        followUpEmail({
          product: project.motionAgent?.found?.siteName || project.profile?.name || project.title,
          link: `${config.appOrigin}/p/${project.id}`,
          offerEnds: launchOfferEnds(now),
        })
      );
      sent++;
    } catch (error) {
      console.warn(`[email] follow-up for ${project.id} not sent:`, error instanceof Error ? error.message : error);
    }
  }
  return sent;
};

/** The email for a checkout opened and not finished: back to the preview it was for, else to the Credits page. */
export const checkoutEmail = (p: { product: string | null; link: string; offerEnds: string | null }) => {
  const ends = p.offerEnds ? new Date(`${p.offerEnds}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" }) : null;
  const subject = p.product ? `Your launch film for ${p.product} is one step from finishing` : "You didn't finish your XLaunch checkout";
  const lead = p.product
    ? `You started paying for your launch film for ${p.product} but didn't finish. Nothing was charged, and the film is still planned and waiting.`
    : "You started a checkout on XLaunch but didn't finish. Nothing was charged.";
  const action = p.product ? "Finish my film" : "Pick up where you left off";
  const text = [lead, `\n${action}: ${p.link}`, ends ? `\nLaunch prices are on until ${ends}.` : "", `\nYou're getting this one email about it. We won't send another.`].join("\n");
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1f1f1e">
  <p style="font-size:16px;margin:0 0 12px">${esc(lead)}</p>
  <p style="margin:24px 0"><a href="${esc(p.link)}" style="background:#1f1f1e;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600;display:inline-block">${action}</a></p>
  ${ends ? `<p style="font-size:14px;color:#6b6b68">Launch prices are on until ${esc(ends)}.</p>` : ""}
  <p style="font-size:12px;color:#9d9d99;margin-top:32px">You're getting this one email about it. We won't send another.</p>
</div>`;
  return { subject, text, html };
};

type FunnelRow = { event: string; user_id: string | null; project_id: string | null; at: string };

/**
 * Checkouts left unfinished: per account, its latest checkout opened 1-48
 * hours ago with no payment since, for accounts never sent this email.
 */
export const abandonedCheckouts = (rows: FunnelRow[], now: number): Array<{ userId: string; projectId: string | null }> => {
  const latest = new Map<string, FunnelRow>();
  const paidAt = new Map<string, number>();
  const emailed = new Set<string>();
  for (const r of rows) {
    if (!r.user_id) continue;
    const at = Date.parse(r.at);
    if (r.event === "checkout_started") {
      const prev = latest.get(r.user_id);
      if (!prev || at > Date.parse(prev.at)) latest.set(r.user_id, r);
    } else if (r.event === "paid") paidAt.set(r.user_id, Math.max(at, paidAt.get(r.user_id) ?? 0));
    // a paywall reminder already sent counts too: the preview email promises at most one reminder
    else if (r.event === "checkout_email_sent" || r.event === "paywall_email_sent") emailed.add(r.user_id);
  }
  return [...latest.values()]
    .filter((r) => {
      const at = Date.parse(r.at);
      return at <= now - CHECKOUT_AFTER_MS && at >= now - UNTIL_MS && !emailed.has(r.user_id!) && (paidAt.get(r.user_id!) ?? 0) < at;
    })
    .map((r) => ({ userId: r.user_id!, projectId: r.project_id }));
};

/** Email every unfinished checkout that is due. Returns how many were sent. */
export const sendCheckoutFollowUps = async (now = Date.now()): Promise<number> => {
  if (!enabled()) return 0;
  const recent = must(
    await db()
      .from("funnel_events")
      .select("event, user_id, project_id, at")
      .in("event", ["checkout_started", "paid"])
      .gte("at", new Date(now - UNTIL_MS).toISOString())
      .limit(1000),
    "checkouts to follow up"
  ) as FunnelRow[];
  const users = [...new Set(recent.filter((r) => r.event === "checkout_started" && r.user_id).map((r) => r.user_id!))];
  if (users.length === 0) return 0;
  // sent at any time before, not just in the window
  const sent = must(
    await db().from("funnel_events").select("event, user_id, project_id, at").in("event", ["checkout_email_sent", "paywall_email_sent"]).in("user_id", users),
    "checkout emails sent"
  ) as FunnelRow[];
  let count = 0;
  for (const due of abandonedCheckouts([...recent, ...sent], now)) {
    // claimed first, so a restart or a second pass never sends it twice
    must(await db().from("funnel_events").insert({ event: "checkout_email_sent", user_id: due.userId, project_id: due.projectId }), "mark checkout email");
    const project = due.projectId ? await getProject(due.projectId).catch(() => null) : null;
    const waiting = project && isUnpaidPreview(project) && project.stage === "preview" ? project : null;
    if (waiting) {
      // the preview's one email: taken now if still unsent, else this one isn't sent
      const claimed = must(
        await db().from("free_previews").update({ emailed_at: new Date(now).toISOString() }).eq("user_id", due.userId).is("emailed_at", null).select("user_id"),
        "claim preview email"
      ) as unknown[];
      if (claimed.length === 0) continue;
    }
    const who = must(await db().from("user_plans").select("email").eq("user_id", due.userId).maybeSingle(), "checkout email address") as { email?: string } | null;
    if (!who?.email) continue;
    try {
      await sendEmail(
        who.email,
        checkoutEmail({
          product: waiting ? waiting.motionAgent?.found?.siteName || waiting.profile?.name || waiting.title : null,
          link: waiting ? `${config.appOrigin}/p/${waiting.id}` : `${config.appOrigin}/billing`,
          offerEnds: launchOfferEnds(now),
        })
      );
      count++;
    } catch (error) {
      console.warn(`[email] checkout follow-up for ${due.userId} not sent:`, error instanceof Error ? error.message : error);
    }
  }
  return count;
};

/** The first-purchase guarantee, as the /refunds page states it. */
const GUARANTEE =
  "First-purchase guarantee: if your first purchase isn't for you, email us within 7 days and we refund it in full, as long as you've used fewer than half of its credits.";

/**
 * The email for a paywall seen and left: the film is planned, its opening
 * built. `price`: the One video price, only when that pack finishes this
 * film. `guarantee`: only for accounts that have never bought.
 */
export const paywallEmail = (p: { product: string; link: string; price: string | null; guarantee: boolean }) => {
  const subject = `Your launch film for ${p.product} is ready to finish`;
  const lead = `Your launch film for ${p.product} is planned, and its opening is already built. The rest is one step away.`;
  const offer = p.price ? `Finish it for ${p.price} with the One video pack.` : "Finish it from your preview.";
  const action = p.price ? `Finish this video · ${p.price}` : "Finish this video";
  const footer = "You're getting this because you saw your preview on XLaunch. We won't send another reminder about it.";
  const text = [lead, `\n${offer}\n${p.link}`, ...(p.guarantee ? [`\n${GUARANTEE}`] : []), `\n${footer}`].join("\n");
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1f1f1e">
  <p style="font-size:16px;margin:0 0 12px">Your launch film for <b>${esc(p.product)}</b> is planned, and its opening is already built. The rest is one step away.</p>
  <p style="font-size:15px;margin:0 0 12px">${esc(offer)}</p>
  <p style="margin:24px 0"><a href="${esc(p.link)}" style="background:#1f1f1e;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600;display:inline-block">${esc(action)}</a></p>
${p.guarantee ? `  <p style="font-size:14px;color:#6b6b68">${esc(GUARANTEE)}</p>\n` : ""}  <p style="font-size:12px;color:#9d9d99;margin-top:32px">${esc(footer)}</p>
</div>`;
  return { subject, text, html };
};

/**
 * Paywalls seen and left: per account, its latest paywall view 24-72 hours
 * ago (for a project), with no checkout started and no payment since its
 * first view, for accounts never sent this email and not admins.
 */
export const paywallReminders = (rows: FunnelRow[], admins: ReadonlySet<string>, now: number): Array<{ userId: string; projectId: string }> => {
  const latest = new Map<string, FunnelRow>();
  const firstSeen = new Map<string, number>();
  const actedAt = new Map<string, number>();
  const emailed = new Set<string>();
  for (const r of rows) {
    if (!r.user_id) continue;
    const at = Date.parse(r.at);
    if (r.event === "paywall_viewed") {
      const prev = latest.get(r.user_id);
      if (!prev || at > Date.parse(prev.at)) latest.set(r.user_id, r);
      firstSeen.set(r.user_id, Math.min(at, firstSeen.get(r.user_id) ?? Infinity));
    } else if (r.event === "checkout_started" || r.event === "paid") actedAt.set(r.user_id, Math.max(at, actedAt.get(r.user_id) ?? 0));
    else if (r.event === "paywall_email_sent") emailed.add(r.user_id);
  }
  return [...latest.values()]
    .filter((r) => {
      const user = r.user_id!;
      const at = Date.parse(r.at);
      return (
        !!r.project_id &&
        at <= now - PAYWALL_AFTER_MS &&
        at >= now - PAYWALL_UNTIL_MS &&
        !emailed.has(user) &&
        !admins.has(user) &&
        (actedAt.get(user) ?? 0) < firstSeen.get(user)!
      );
    })
    .map((r) => ({ userId: r.user_id!, projectId: r.project_id! }));
};

/** The One video pack's price as shown ("$15"), or null when it isn't on sale. */
const oneVideoPrice = (): string | null => {
  const pack = productBySku("pack_one");
  if (!pack || !productIdFor("pack_one")) return null;
  const dollars = pack.priceCents / 100;
  return `$${Number.isInteger(dollars) ? dollars : dollars.toFixed(2)}`;
};

/** The One video price, only when that pack covers what finishing this film needs beyond the balance (as the paywall prices it). */
const finishPrice = async (project: Project, userId: string): Promise<string | null> => {
  const credits = productBySku("pack_one")?.credits;
  if (credits === undefined) return null;
  const short = Math.max(0, videoPriceOf(project).estimate - (await balanceOf(userId)).total);
  return short <= credits ? oneVideoPrice() : null;
};

/** Email every paywall left without a checkout that is due. Returns how many were sent. */
export const sendPaywallFollowUps = async (now = Date.now()): Promise<number> => {
  if (!enabled()) return 0;
  const recent = must(
    await db()
      .from("funnel_events")
      .select("event, user_id, project_id, at")
      .in("event", ["paywall_viewed", "checkout_started", "paid"])
      .gte("at", new Date(now - PAYWALL_UNTIL_MS).toISOString())
      .limit(2000),
    "paywalls to follow up"
  ) as FunnelRow[];
  const users = [...new Set(recent.filter((r) => r.event === "paywall_viewed" && r.user_id).map((r) => r.user_id!))];
  if (users.length === 0) return 0;
  // sent at any time before, not just in the window
  const sent = must(
    await db().from("funnel_events").select("event, user_id, project_id, at").eq("event", "paywall_email_sent").in("user_id", users),
    "paywall emails sent"
  ) as FunnelRow[];
  const admins = new Set(
    (must(await db().from("user_plans").select("user_id").eq("is_admin", true).in("user_id", users), "admins") as Array<{ user_id: string }>).map((r) => r.user_id)
  );
  let count = 0;
  for (const due of paywallReminders([...recent, ...sent], admins, now)) {
    // claimed first, so a restart or a second pass never sends it twice
    must(await db().from("funnel_events").insert({ event: "paywall_email_sent", user_id: due.userId, project_id: due.projectId }), "mark paywall email");
    const project = await getProject(due.projectId).catch(() => null);
    if (!project || project.userId !== due.userId || !isUnpaidPreview(project) || project.stage !== "preview") continue;
    const who = must(await db().from("user_plans").select("email").eq("user_id", due.userId).maybeSingle(), "paywall email address") as { email?: string } | null;
    if (!who?.email) continue;
    try {
      await sendEmail(
        who.email,
        paywallEmail({
          product: project.motionAgent?.found?.siteName || project.profile?.name || project.title,
          link: `${config.appOrigin}/p/${project.id}`,
          price: await finishPrice(project, due.userId),
          guarantee: !(await hasPurchased(due.userId)),
        })
      );
      count++;
    } catch (error) {
      console.warn(`[email] paywall follow-up for ${project.id} not sent:`, error instanceof Error ? error.message : error);
    }
  }
  return count;
};

/** The email for a preview finished as a gift (scripts/gift-finish.ts): the film, and a request for one line back. */
export const giftEmail = (p: { host: string; link: string }) => {
  const subject = `Your launch film for ${p.host} is finished, on us`;
  const lead = `Your launch film for ${p.host} is finished, on us. Nothing was charged.`;
  const ask = "Could you reply with one line of honest feedback? What worked, what didn't, or why you stopped at the preview.";
  const text = [lead, `\nWatch it here: ${p.link}`, `\n${ask}`].join("\n");
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1f1f1e">
  <p style="font-size:16px;margin:0 0 12px">Your launch film for <b>${esc(p.host)}</b> is finished, on us. Nothing was charged.</p>
  <p style="margin:24px 0"><a href="${esc(p.link)}" style="background:#1f1f1e;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600;display:inline-block">Watch your film</a></p>
  <p style="font-size:15px;margin:0 0 12px">${esc(ask)}</p>
</div>`;
  return { subject, text, html };
};

/** Check for due follow-ups every 10 minutes (from the database, so a restart loses nothing). */
export const startFollowUps = (): void => {
  if (!enabled()) return;
  const tick = () => {
    void sendFollowUps().then(
      (n) => n && console.log(`[email] sent ${n} preview follow-up(s)`),
      (error) => console.warn("[email] follow-ups failed:", error instanceof Error ? error.message : error)
    );
    void sendCheckoutFollowUps().then(
      (n) => n && console.log(`[email] sent ${n} checkout follow-up(s)`),
      (error) => console.warn("[email] checkout follow-ups failed:", error instanceof Error ? error.message : error)
    );
    void sendPaywallFollowUps().then(
      (n) => n && console.log(`[email] sent ${n} paywall follow-up(s)`),
      (error) => console.warn("[email] paywall follow-ups failed:", error instanceof Error ? error.message : error)
    );
  };
  setInterval(tick, EVERY_MS).unref();
  tick();
};
