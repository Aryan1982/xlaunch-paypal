import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { API_ORIGIN } from "@/lib/api-origin";

/**
 * Runs before every page and /api request.
 *
 * - Keeps the Supabase session fresh (cookies) and forwards /api calls to the
 *   API server with the user's access token as a bearer token, so plain
 *   EventSource, <img> and download links work with no client code.
 * - Passes an XLaunch API key (Authorization: Bearer xl_...) straight through,
 *   for scripts and MCP clients at /api/mcp.
 * - Refuses cross-site writes to /api (the session is a cookie here).
 * - Sends signed-out visitors to /login, except on public pages (the home
 *   page is one: visitors see the examples, and sign in to generate).
 * - On the preview host (NEXT_PUBLIC_PREVIEW_ORIGIN) serves only the
 *   sandboxed frame and what it loads: nothing there carries a session.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

// Public: the home page and what crawlers, AI answer engines and link previews fetch
const PUBLIC_PAGES = [
  /^\/(robots\.txt|sitemap\.xml|llms\.txt|llms-full\.txt|manifest\.webmanifest)$/,
  /(^|\/)(opengraph|twitter)-image(\.[a-z]+)?$/,
  /^\/$/,
  /^\/examples$/,
  /^\/for(\/[a-z0-9-]+)?$/,
  /^\/login$/,
  /^\/auth\//,
  /^\/frame$/,
  /^\/terms$/,
  /^\/privacy$/,
  /^\/refunds$/,
  /^\/pricing$/,
  /^\/alternatives(\/[a-z0-9-]+)?$/,
  /^\/s\/[^/]+$/,
];
// a film's own files (images, the fetched logo) load from the preview origin too; the API checks each one's signature
const PREVIEW_ALLOWED = [
  /^\/frame$/,
  /^\/_next\//,
  /^\/compiler\//,
  /^\/api\/projects\/[^/]+\/assets\/[^/]+$/,
  /^\/api\/projects\/[^/]+\/motion\/public\/.+$/,
  /^\/api\/audio\//,
];

const previewHost = (): string | null => {
  try {
    return process.env.NEXT_PUBLIC_PREVIEW_ORIGIN ? new URL(process.env.NEXT_PUBLIC_PREVIEW_ORIGIN).host : null;
  } catch {
    return null;
  }
};

/** The origin the browser used (behind nginx this server sees http on loopback). */
const publicOrigin = (request: NextRequest): string => process.env.NEXT_PUBLIC_APP_ORIGIN || request.nextUrl.origin;

/**
 * An XLaunch API key sent by a script or MCP client. It is a header, not a
 * cookie, so a cross-site page can't send it, and it never mixes with a session.
 */
const bearerApiKey = (request: NextRequest): string | null => {
  const match = /^Bearer (xl_[A-Za-z0-9_-]{40})$/.exec(request.headers.get("authorization") ?? "");
  return match ? match[1]! : null;
};

/** An MCP client's token: an API key, or the OAuth access token Supabase issued it (the API verifies either). */
const bearerToken = (request: NextRequest): string | null => /^Bearer (\S+)$/.exec(request.headers.get("authorization") ?? "")?.[1] ?? null;

/**
 * The API runs on another host (this app is on Vercel), so nginx there sees
 * Vercel's address, not the visitor's: send the visitor's (Vercel's own
 * X-Real-IP / X-Forwarded-For, which it overwrites) beside the shared
 * PROXY_SECRET, the only way the API trusts it (free previews are counted per address).
 */
const forward = (request: NextRequest, token: string | null) => {
  const headers = new Headers(request.headers);
  headers.delete("cookie"); // the API reads the bearer token, never browser cookies
  headers.delete("authorization");
  headers.delete("x-xlaunch-proxy-secret");
  headers.delete("x-xlaunch-client-ip");
  if (token) headers.set("authorization", `Bearer ${token}`);
  const secret = process.env.PROXY_SECRET;
  const visitor = request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (secret && visitor) {
    headers.set("x-xlaunch-proxy-secret", secret);
    headers.set("x-xlaunch-client-ip", visitor);
  }
  const target = new URL(request.nextUrl.pathname + request.nextUrl.search, API_ORIGIN);
  return NextResponse.rewrite(target, { request: { headers } });
};

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const preview = previewHost();
  if (preview && request.headers.get("host") === preview) {
    if (!PREVIEW_ALLOWED.some((re) => re.test(pathname))) return new NextResponse("Not found", { status: 404 });
    return pathname.startsWith("/api/") ? forward(request, null) : NextResponse.next();
  }

  // how an MCP client signs in (served by the API): public, and never the browser's session
  if (pathname.startsWith("/.well-known/oauth-protected-resource")) return forward(request, null);
  if (pathname === "/api/mcp") return forward(request, bearerToken(request));

  const isApi = pathname.startsWith("/api/");
  const apiKey = isApi ? bearerApiKey(request) : null;
  if (apiKey) return forward(request, apiKey);

  if (isApi && !["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    // Compare hosts: behind the TLS-terminating nginx this server sees http://.
    const origin = request.headers.get("origin");
    let sameSite = true;
    try {
      sameSite = !origin || new URL(origin).host === request.headers.get("host");
    } catch {
      sameSite = false;
    }
    if (!sameSite) {
      return NextResponse.json({ error: "Cross-site request refused." }, { status: 403 });
    }
  }

  // Without Supabase configured: local mode, no sign-in. Never in production (a missing variable must not open the app).
  if (!SUPABASE_URL) {
    if (process.env.NODE_ENV === "production") return new NextResponse("Sign-in is not configured.", { status: 503 });
    return isApi ? forward(request, null) : NextResponse.next();
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });
  // Refreshes an expired access token (writing new cookies through setAll).
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const carryCookies = (out: NextResponse) => {
    for (const cookie of response.cookies.getAll()) out.cookies.set(cookie);
    return out;
  };

  if (isApi) return carryCookies(forward(request, session?.access_token ?? null));

  if (!session && !PUBLIC_PAGES.some((re) => re.test(pathname))) {
    const login = new URL("/login", publicOrigin(request));
    // what sent them to sign in, for the funnel (lib/funnel.ts SIGNIN_SOURCES): a preview, the Credits page, or another private page
    login.searchParams.set("from", pathname.startsWith("/p/") ? "preview" : pathname === "/billing" ? "billing" : "redirect");
    if (pathname !== "/") login.searchParams.set("next", pathname + request.nextUrl.search);
    return carryCookies(NextResponse.redirect(login));
  }
  if (session && pathname === "/login") return carryCookies(NextResponse.redirect(new URL("/", publicOrigin(request))));
  return response;
}

export const config = {
  // static files served as they are (badge/ and badges/: the directory badges, lib/badges.ts; intro/: the home page's XLaunch film)
  matcher: ["/((?!_next/static|_next/image|compiler/|logo/|badges?/|intro/|favicon.ico|icon.png|apple-icon.png|hero.svg|hero-3d.svg).*)"],
};
