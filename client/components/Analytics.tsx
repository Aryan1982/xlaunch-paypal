"use client";

import { usePathname } from "next/navigation";
import Script from "next/script";

import { SITE_URL } from "@/lib/site";

/**
 * Google Analytics (gtag.js), the same property as the old waitlist site so its history carries on.
 * NEXT_PUBLIC_GA_ID changes it; set it empty to turn analytics off. It loads only on the live site's
 * host (a local or test build never reports) and never inside the sandboxed preview frame. gtag.js is
 * served with Cross-Origin-Resource-Policy: cross-origin, so it loads under the app's COEP.
 */
const GA_ID = process.env.NEXT_PUBLIC_GA_ID ?? "G-EJCXYWN12R";
const LIVE_HOST = new URL(SITE_URL).hostname;

/** A browser marked internal (an admin signed in on it, or `?internal=1`) never reports; `?internal=0` clears the mark. */
export const INTERNAL_KEY = "xlaunch:internal";

export const markInternal = (): void => {
  try {
    localStorage.setItem(INTERNAL_KEY, "1");
  } catch {
    // storage blocked: nothing to remember
  }
};

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

/** Sends an event to Google Analytics when it is loaded; a no-op otherwise. */
export const gaEvent = (name: string, params: Record<string, unknown> = {}): void => {
  window.gtag?.("event", name, params);
};

export function Analytics() {
  const path = usePathname();
  if (!GA_ID || path?.startsWith("/frame")) return null;
  // the host check runs in the browser, so the server render stays the same everywhere.
  // Back from sign-in, the auth callback leaves `xl_auth` (sign_up or login, and the method): sent once, then cleared.
  const auth = `var a=/(?:^|; )xl_auth=(sign_up|login)\\.(google|email)/.exec(document.cookie);if(a){gtag('event',a[1],{method:a[2]});document.cookie='xl_auth=; Max-Age=0; path=/';}`;
  const internal = `var q=new URLSearchParams(location.search).get('internal');try{if(q==='1')localStorage.setItem('${INTERNAL_KEY}','1');if(q==='0')localStorage.removeItem('${INTERNAL_KEY}');var skip=localStorage.getItem('${INTERNAL_KEY}')==='1';}catch(e){var skip=false;}`;
  const boot = `${internal}if(!skip&&location.hostname===${JSON.stringify(LIVE_HOST)}){var s=document.createElement('script');s.async=true;s.src='https://www.googletagmanager.com/gtag/js?id=${GA_ID}';document.head.appendChild(s);window.dataLayer=window.dataLayer||[];window.gtag=function(){dataLayer.push(arguments);};gtag('js',new Date());gtag('config','${GA_ID}');${auth}}`;
  return (
    <Script id="google-analytics" strategy="afterInteractive">
      {boot}
    </Script>
  );
}
