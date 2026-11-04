/**
 * The video preview runs generated code, so it lives in an iframe on its own
 * origin (`/frame` on the preview host): nothing it runs can read this app's
 * cookies, storage or session. The two sides talk only through these messages.
 *
 * Production: NEXT_PUBLIC_APP_ORIGIN=https://app.<domain>,
 * NEXT_PUBLIC_PREVIEW_ORIGIN=https://preview.<domain> (same Next server).
 * Local dev: the app on localhost and the frame on 127.0.0.1 are already two
 * origins, so nothing needs setting.
 */

export type ToFrame =
  | {
      type: "load";
      files: Record<string, string>;
      compositionId: string;
      /** The bundle's entry (default src/Root.tsx). */
      entryPoint?: string;
      /** staticFile() names and the URLs they load from (a motion film's public files). */
      staticFiles?: Array<{ name: string; src: string }>;
      autoPlay: boolean;
      loop: boolean;
      /** Play only up to this many seconds (a free preview's opening), then loop or stop there. */
      until?: number;
    }
  | { type: "seek"; frame: number }
  | { type: "toggle" };

export type FromFrame =
  | { type: "ready" }
  | { type: "status"; text: string }
  | { type: "loaded" }
  | { type: "error"; message: string }
  | { type: "frame"; frame: number }
  | { type: "key"; code: string; shiftKey: boolean };

/** The other dev hostname for the same port: localhost <-> 127.0.0.1. */
const devTwin = (): string => {
  const { protocol, hostname, port } = window.location;
  const twin = hostname === "127.0.0.1" ? "localhost" : "127.0.0.1";
  return `${protocol}//${twin}${port ? `:${port}` : ""}`;
};

/** Origin serving `/frame` (seen from the app). */
export const previewOrigin = (): string => process.env.NEXT_PUBLIC_PREVIEW_ORIGIN || devTwin();

/** Origin of the app allowed to drive the frame (seen from the frame). */
export const appOrigin = (): string => process.env.NEXT_PUBLIC_APP_ORIGIN || devTwin();

/** Keys the studio handles (play/pause, scrub); the frame forwards them up. */
export const FORWARDED_KEYS = new Set(["Space", "ArrowLeft", "ArrowRight"]);

/** What the studio needs from the player: a subset of Remotion's PlayerRef. */
export type PreviewHandle = {
  seekTo: (frame: number) => void;
  toggle: () => void;
  getCurrentFrame: () => number;
  addEventListener: (event: "frameupdate", cb: (e: { detail: { frame: number } }) => void) => void;
  removeEventListener: (event: "frameupdate", cb: (e: { detail: { frame: number } }) => void) => void;
};
