"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Player, type PlayerRef } from "@remotion/player";

import { compileProject, type Preview } from "@/lib/compiler";
import { appOrigin, FORWARDED_KEYS, type FromFrame, type ToFrame } from "@/lib/preview-bridge";

/** staticFile() resolves through this list (Remotion's own lookup), so a film's public files load from the API. */
const applyStaticFiles = (files: Array<{ name: string; src: string }>) => {
  window.remotion_staticFiles = files.map((f) => ({
    name: f.name,
    src: new URL(f.src, window.location.origin).href,
    sizeInBytes: 0,
    lastModified: 0,
  }));
};

/** A compile error with the compiler's own reasons (the bundler's error carries them as `diagnostics`). */
const errorText = (e: unknown): string => {
  if (!(e instanceof Error)) return String(e);
  const diagnostics = "diagnostics" in e && Array.isArray(e.diagnostics) ? e.diagnostics : [];
  const reasons = diagnostics
    .map((d: unknown) => (typeof d === "string" ? d : d && typeof d === "object" && "message" in d ? String(d.message) : ""))
    .filter(Boolean)
    .slice(0, 3);
  return reasons.length ? `${e.message}: ${reasons.join("\n")}` : e.message;
};

/**
 * The sandboxed preview (see lib/preview-bridge.ts). Served on the preview
 * origin and embedded by the studio; it compiles the files it is sent and plays
 * them. It never fetches project data itself and holds no credentials.
 */
export default function PreviewFrame() {
  const playerRef = useRef<PlayerRef>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [options, setOptions] = useState<{ autoPlay: boolean; loop: boolean; until?: number }>({ autoPlay: false, loop: true });

  useEffect(() => {
    if (window.parent === window) return;
    const parentOrigin = appOrigin();
    const post = (message: FromFrame) => window.parent.postMessage(message, parentOrigin);
    let controller: AbortController | null = null;

    const onMessage = async (event: MessageEvent<ToFrame>) => {
      if (event.origin !== parentOrigin || event.source !== window.parent) return;
      const message = event.data;
      if (message.type === "load") {
        controller?.abort();
        const current = (controller = new AbortController());
        setOptions({ autoPlay: message.autoPlay, loop: message.loop, until: message.until });
        try {
          applyStaticFiles(message.staticFiles ?? []);
          const compiled = await compileProject({
            files: message.files,
            compositionId: message.compositionId,
            entryPoint: message.entryPoint,
            onProgress: (text) => post({ type: "status", text }),
            signal: current.signal,
          });
          if (current.signal.aborted) return;
          setPreview(compiled);
          post({ type: "loaded" });
        } catch (e) {
          if (current.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) return;
          post({ type: "error", message: errorText(e) });
        }
      } else if (message.type === "seek") {
        playerRef.current?.seekTo(message.frame);
      } else if (message.type === "toggle") {
        playerRef.current?.toggle();
      }
    };

    // The studio's shortcuts live in the parent; keys pressed in here go up.
    const onKey = (e: KeyboardEvent) => {
      if (!FORWARDED_KEYS.has(e.code)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      post({ type: "key", code: e.code, shiftKey: e.shiftKey });
    };

    window.addEventListener("message", onMessage);
    window.addEventListener("keydown", onKey, true);
    post({ type: "ready" });
    return () => {
      controller?.abort();
      window.removeEventListener("message", onMessage);
      window.removeEventListener("keydown", onKey, true);
    };
  }, []);

  // Report the playhead to the studio's timeline.
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const onFrame = (e: { detail: { frame: number } }) =>
      window.parent.postMessage({ type: "frame", frame: e.detail.frame } satisfies FromFrame, appOrigin());
    player.addEventListener("frameupdate", onFrame);
    return () => player.removeEventListener("frameupdate", onFrame);
  }, [preview]);

  // A stable object: a new inputProps on every render restarts the player's clock.
  const inputProps = useMemo(() => preview?.props, [preview]);

  if (!preview) return <div style={{ position: "fixed", inset: 0, background: "#000" }} />;
  return (
    <div style={{ position: "fixed", inset: 0, background: "#000" }}>
      <Player
        ref={playerRef}
        component={preview.component}
        durationInFrames={preview.durationInFrames}
        fps={preview.fps}
        compositionWidth={preview.width}
        compositionHeight={preview.height}
        inputProps={inputProps}
        // a free preview plays its opening only: the rest of the film isn't built yet
        {...(options.until ? { outFrame: Math.min(preview.durationInFrames, Math.round(options.until * preview.fps)) - 1 } : {})}
        controls
        loop={options.loop}
        autoPlay={options.autoPlay}
        clickToPlay
        acknowledgeRemotionLicense
        allowFullscreen
        // narration + music + overlapping effects can exceed the default of 5 shared audio tags
        numberOfSharedAudioTags={24}
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
}
