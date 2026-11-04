"use client";

import React, { useEffect, useImperativeHandle, useRef, useState, useSyncExternalStore } from "react";

import { api } from "@/lib/api";
import { previewOrigin, type FromFrame, type PreviewHandle, type ToFrame } from "@/lib/preview-bridge";
import { Spinner, ErrorBanner, cn } from "@/components/ui";

/** Whose film plays: a project of the signed-in user, or one opened by its share link (no session). */
type Film = { projectId: string } | { shareToken: string };

type Props = Film & {
  /** Recompile whenever this changes. */
  version: number;
  playerRef?: React.Ref<PreviewHandle>;
  autoPlay?: boolean;
  loop?: boolean;
  /** The video's shape: a vertical one is sized by height, centred. */
  aspect?: "16:9" | "9:16";
  /** Play only up to this many seconds (a free preview's opening). */
  until?: number;
};

const noSubscribe = () => () => {};

type FrameListener = (e: { detail: { frame: number } }) => void;

/**
 * The generated video plays in a sandboxed iframe on the preview origin
 * (app/frame, lib/preview-bridge.ts). This side fetches the source (with the
 * user's session, or by the share link) and hands it over; the frame compiles and plays it.
 */
export function VideoPlayer(props: Props) {
  const { version, playerRef, autoPlay = false, loop = true, aspect = "16:9", until } = props;
  const film = "shareToken" in props ? props.shareToken : props.projectId;
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [frameReady, setFrameReady] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState("Preparing preview…");
  const [error, setError] = useState<string | null>(null);
  // Known only in the browser (it may depend on the page's own host).
  const origin = useSyncExternalStore(noSubscribe, previewOrigin, () => null);
  const current = useRef(0);
  const listeners = useRef(new Set<FrameListener>());

  const send = (message: ToFrame) => {
    if (origin) frameRef.current?.contentWindow?.postMessage(message, origin);
  };

  useImperativeHandle(
    playerRef,
    (): PreviewHandle => ({
      seekTo: (frame) => {
        current.current = frame;
        send({ type: "seek", frame });
      },
      toggle: () => send({ type: "toggle" }),
      getCurrentFrame: () => current.current,
      addEventListener: (_event, cb) => listeners.current.add(cb),
      removeEventListener: (_event, cb) => listeners.current.delete(cb),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [origin]
  );

  // Messages from the frame.
  useEffect(() => {
    if (!origin) return;
    const onMessage = (event: MessageEvent<FromFrame>) => {
      if (event.origin !== origin || event.source !== frameRef.current?.contentWindow) return;
      const message = event.data;
      if (message.type === "ready") setFrameReady(true);
      else if (message.type === "status") setStatus(message.text);
      else if (message.type === "loaded") setLoaded(true);
      else if (message.type === "error") setError(message.message);
      else if (message.type === "frame") {
        current.current = message.frame;
        for (const cb of listeners.current) cb({ detail: { frame: message.frame } });
      } else if (message.type === "key") {
        // Replay it here, where the studio's shortcuts listen.
        window.dispatchEvent(new KeyboardEvent("keydown", { code: message.code, shiftKey: message.shiftKey }));
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [origin]);

  // Fetch the source (with the session, or by the share link) and hand it to the frame.
  useEffect(() => {
    if (!frameReady) return;
    let cancelled = false;
    (async () => {
      setError(null);
      try {
        setStatus("Fetching scenes…");
        const source = await ("shareToken" in props ? api.sharedSource(props.shareToken) : api.source(props.projectId));
        if (cancelled) return;
        send({
          type: "load",
          files: source.files,
          compositionId: source.compositionId,
          entryPoint: source.entryPoint,
          staticFiles: source.staticFiles,
          autoPlay,
          loop,
          until,
        });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameReady, film, version]);

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-line bg-black",
        aspect === "9:16" ? "mx-auto aspect-[9/16] h-[min(76vh,820px)] max-w-full" : "aspect-video w-full"
      )}
    >
      {origin && (
        <iframe
          ref={frameRef}
          src={`${origin}/frame`}
          title="Video preview"
          // Scripts run, but on the preview origin only: no top navigation, popups or forms.
          sandbox="allow-scripts allow-same-origin"
          allow="autoplay; fullscreen; cross-origin-isolated"
          allowFullScreen
          className="absolute inset-0 h-full w-full border-0"
          style={{ visibility: loaded && !error ? "visible" : "hidden" }}
        />
      )}
      {error ? (
        <div className="absolute inset-0 grid place-items-center p-6">
          <ErrorBanner message={`Preview failed to compile: ${error}`} />
        </div>
      ) : !loaded ? (
        <div className="absolute inset-0 grid place-items-center">
          <div className="flex flex-col items-center gap-3 text-sm text-mute">
            <Spinner className="size-6 text-accent" />
            {status}
          </div>
        </div>
      ) : null}
    </div>
  );
}
