"use client";

import { gaEvent } from "@/components/Analytics";

/**
 * Funnel steps only the page sees (server: usage/funnel.ts). Each browser
 * keeps one random id, sent signed in or not, so a visit can be followed to
 * the account it became. Fire and forget: a lost step never shows an error,
 * and `keepalive` lets it finish while the page moves on (Generate → sign-in).
 */

export type FunnelStep = "visit" | "generate_clicked" | "generate_rejected" | "signin_viewed" | "paywall_viewed" | "checkout_cancelled";

/** Why Generate was refused (generate_rejected), or what opened the sign-in page (signin_viewed); mirrors STEP_SOURCES in server/src/usage/funnel.ts. */
export type StepSource = (typeof SIGNIN_SOURCES)[number] | "empty" | "no_url";

/** What can open the sign-in page, as `/login?from=…`: anything else (or nothing) counts as "direct". */
export const SIGNIN_SOURCES = ["generate", "header", "pricing", "preview", "billing", "redirect", "expired", "share", "signout", "direct"] as const;
export type SigninSource = (typeof SIGNIN_SOURCES)[number];

/** The sign-in page's address, tagged with what led there and where to go after. */
export const loginHref = (from: SigninSource, next?: string): string =>
  `/login?from=${from}${next && next !== "/" ? `&next=${encodeURIComponent(next)}` : ""}`;

/** On the address the sign-in callback sends people back to (auth/callback/route.ts): an arrival from sign-in, not a visit. */
const SIGNED_IN = "signed_in";

const VISITOR = "xlaunch:visitor";
const VISITED = "xlaunch:visited";
// where sign-in comes back from when the callback's mark is missing (Google, or Supabase falling back to the site address)
const AUTH_REFERRER = /^https:\/\/([^/]+\.)?(accounts\.google\.com|supabase\.co)(\/|$)/;

const visitor = (): string | undefined => {
  try {
    let id = localStorage.getItem(VISITOR);
    if (!id) {
      id = crypto.randomUUID().replace(/-/g, "");
      localStorage.setItem(VISITOR, id);
    }
    return id;
  } catch {
    return undefined;
  }
};

export const track = (event: FunnelStep, extra: { projectId?: string; utm?: string; referrer?: string; source?: StepSource } = {}): void => {
  // Google Analytics counts page views itself; the steps are its conversion events
  if (event !== "visit") gaEvent(event, extra.source ? { source: extra.source } : {});
  void fetch("/api/funnel", {
    method: "POST",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event, visitor: visitor(), ...extra }),
  }).catch(() => undefined);
};

/**
 * A visit: once per tab session, with where it came from (utm_source, else `utm` (a page that is
 * itself the source, such as a share link), else the referrer).
 * Back from sign-in is not one: the tab counts as visited, and the callback's mark leaves the address.
 */
export const trackVisit = ({ utm: fallback }: { utm?: string } = {}): void => {
  const url = new URL(window.location.href);
  const back = url.searchParams.has(SIGNED_IN) || AUTH_REFERRER.test(document.referrer);
  if (url.searchParams.has(SIGNED_IN)) {
    url.searchParams.delete(SIGNED_IN);
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }
  try {
    if (sessionStorage.getItem(VISITED)) return;
    sessionStorage.setItem(VISITED, "1");
  } catch {
    // storage blocked: count it anyway
  }
  if (back) return;
  const utm = url.searchParams.get("utm_source") ?? fallback;
  track("visit", { ...(utm ? { utm } : {}), ...(document.referrer ? { referrer: document.referrer } : {}) });
};
