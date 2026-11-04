import { db, dbEnabled } from "../db";

/**
 * The funnel, one row per step (db/009, db/011): from the first visit to a
 * finished paid film. Steps the browser sees (`CLIENT_EVENTS`) carry an
 * anonymous browser id (`visitor`), which links a visitor to their account
 * once they sign in; a visit also says where it came from (`source`), a
 * blocked Generate why (`STEP_SOURCES`), and a sign-in page what led to it.
 * Never throws: a missed row is logged, not shown.
 */
export const FUNNEL_EVENTS = [
  "visit",
  "generate_clicked",
  "generate_rejected",
  "signin_viewed",
  "preview_started",
  "preview_ready",
  "paywall_viewed",
  "checkout_started",
  "checkout_cancelled",
  "paid",
  "render_started",
  "video_ready",
  "checkout_email_sent",
  "paywall_email_sent",
] as const;
export type FunnelEvent = (typeof FUNNEL_EVENTS)[number];

/** Steps reported by the page: the first four signed in or not, the rest only with a session. */
export const ANONYMOUS_EVENTS = ["visit", "generate_clicked", "generate_rejected", "signin_viewed"] as const satisfies readonly FunnelEvent[];
export const CLIENT_EVENTS = [...ANONYMOUS_EVENTS, "paywall_viewed", "checkout_cancelled"] as const satisfies readonly FunnelEvent[];
export type ClientEvent = (typeof CLIENT_EVENTS)[number];

/**
 * The page's own `source` for a step: why Generate was refused (generate_rejected), or what opened the sign-in page
 * (signin_viewed): Generate, the header, buying a plan or pack, a redirect from a private page (a preview, the Credits
 * page, any other), a session that ran out, a share page, signing out, or the address opened directly.
 */
export const STEP_SOURCES = ["empty", "no_url", "generate", "header", "pricing", "preview", "billing", "redirect", "expired", "share", "signout", "direct"] as const;
export const SOURCED_EVENTS = ["generate_rejected", "signin_viewed"] as const satisfies readonly ClientEvent[];

type Fields = { userId?: string | null; projectId?: string | null; model?: string | null; visitor?: string | null; source?: string | null };

export const recordFunnel = async (event: FunnelEvent, f: Fields): Promise<void> => {
  if (!dbEnabled()) return;
  try {
    const row = { event, user_id: f.userId ?? null, project_id: f.projectId ?? null, model: f.model ?? null, ...(f.visitor ? { visitor: f.visitor } : {}), ...(f.source ? { source: f.source } : {}) };
    const { error } = await db().from("funnel_events").insert(row);
    if (error) throw new Error(error.message);
  } catch (error) {
    console.warn(`[funnel] ${event} not recorded:`, error instanceof Error ? error.message : error);
  }
};

/** Where a visit came from, as one short label: utm_source, else the referrer's host (not our own), else "direct". */
export const sourceOf = (utm: string | undefined, referrer: string | undefined, ownHost: string): string => {
  let host = "";
  try {
    host = referrer ? new URL(referrer).hostname.replace(/^www\./, "") : "";
  } catch {
    // not a URL: direct
  }
  const raw = utm?.trim() || (host && host !== ownHost.replace(/^www\./, "") ? host : "");
  return raw.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").slice(0, 60) || "direct";
};
