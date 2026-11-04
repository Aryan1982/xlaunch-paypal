import { NextResponse, type NextRequest } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";

/** Read once by Google Analytics on the next page (components/Analytics.tsx, same name), which sends `sign_up` or `login` and clears it. */
const AUTH_COOKIE = "xl_auth";

/**
 * A new account: its address was confirmed by this very sign-in. Supabase sets
 * `email_confirmed_at` on an account's first sign-in (the Google return or the
 * first email link) and `last_sign_in_at` on every one, so the two match only the first time.
 */
const isNewAccount = (user: { email_confirmed_at?: string | null; last_sign_in_at?: string | null }): boolean => {
  const confirmed = Date.parse(user.email_confirmed_at ?? "");
  const last = Date.parse(user.last_sign_in_at ?? "");
  return Number.isFinite(confirmed) && Number.isFinite(last) && Math.abs(last - confirmed) < 60_000;
};

/** Where Google and the email link land: trade the code for a session. */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  // behind nginx this server sees http on loopback; send people back to the public origin
  const origin = process.env.NEXT_PUBLIC_APP_ORIGIN || url.origin;
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next");
  // only paths on this site: never an open redirect (`/\evil.com` parses to another host, hence the origin check)
  let resolved: URL | null = null;
  try {
    resolved = next?.startsWith("/") ? new URL(next, origin) : null;
  } catch {
    // malformed: go home
  }
  const target = resolved && resolved.origin === new URL(origin).origin ? resolved : new URL("/", origin);
  // the home page counts visits: this one is back from sign-in (lib/funnel.ts drops the mark and the visit)
  if (target.pathname === "/") target.searchParams.set("signed_in", "1");
  if (code) {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const res = NextResponse.redirect(target);
      const method = data.user?.app_metadata?.provider === "google" ? "google" : "email";
      // readable by the page's analytics script, gone in ten minutes if it never loads
      res.cookies.set(AUTH_COOKIE, `${data.user && isNewAccount(data.user) ? "sign_up" : "login"}.${method}`, { path: "/", maxAge: 600, sameSite: "lax", secure: origin.startsWith("https:") });
      return res;
    }
  }
  const login = new URL("/login", origin);
  login.searchParams.set("error", url.searchParams.get("error_description") ?? "That sign-in link didn't work. Try again.");
  return NextResponse.redirect(login);
}
