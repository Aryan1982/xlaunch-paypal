import type { NextConfig } from "next";

/** Who may embed the preview frame (lib/preview-bridge.ts). Dev: the app on localhost. */
const APP_ORIGIN = process.env.NEXT_PUBLIC_APP_ORIGIN ?? "http://localhost:*";

const nextConfig: NextConfig = {
  // A second dev server (the test environment) needs its own build folder.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Dev: the preview frame is served on 127.0.0.1 (the app on localhost), see lib/preview-bridge.ts.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  experimental: {
    // /api is proxied to the API server by proxy.ts (same origin: no CORS, and the
    // page stays cross-origin isolated for the WASM bundler). Long-lived SSE
    // connections and slow endpoints must not be cut at 30s.
    proxyTimeout: 10 * 60 * 1000,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      // Cross-origin isolation (the WASM bundler of the live preview), everywhere but the Credits page:
      // PayPal's buttons are iframes and a popup from paypal.com, which COEP blocks and COOP cuts off.
      {
        source: "/((?!billing$).*)",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
      // The app itself is never framed. The public pages (landing, examples, legal) may be.
      {
        source: "/((?!frame$|frame/|examples$|terms$|privacy$).+)",
        headers: [{ key: "Content-Security-Policy", value: "frame-ancestors 'none'" }],
      },
      // The sandboxed preview: embeddable by the app only, across origins (COEP needs CORP).
      {
        source: "/frame",
        headers: [
          { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
          { key: "Content-Security-Policy", value: `frame-ancestors ${APP_ORIGIN}` },
        ],
      },
    ];
  },
};

export default nextConfig;
