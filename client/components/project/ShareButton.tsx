"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Link2 } from "lucide-react";

import { api } from "@/lib/api";
import { gaEvent } from "@/components/Analytics";
import { Button, ErrorBanner, Spinner } from "@/components/ui";

type State =
  | { kind: "closed" }
  | { kind: "making" }
  | { kind: "ready"; url: string; copied: boolean }
  | { kind: "off" }
  | { kind: "error"; message: string };

/**
 * Share: makes the project's public link (/s/<token>, the same one every time)
 * and copies it, so someone without an account (a cofounder) can watch the
 * video. The link is copied inside the click itself (a ClipboardItem that waits
 * for the link), which phones require; where that isn't allowed, the link is
 * shown to copy by hand.
 */
export function ShareButton({ projectId }: { projectId: string }) {
  const [state, setState] = useState<State>({ kind: "closed" });

  useEffect(() => {
    if (state.kind === "closed") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setState({ kind: "closed" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.kind]);

  const copy = async (url: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(url);
      return true;
    } catch {
      return false;
    }
  };

  const share = () => {
    setState({ kind: "making" });
    const link = api.shareProject(projectId).then((token) => `${process.env.NEXT_PUBLIC_APP_ORIGIN || window.location.origin}/s/${token}`);
    // started now, while the click still counts as the user's: Safari refuses a clipboard write that starts after the request
    const written =
      typeof ClipboardItem !== "undefined" && navigator.clipboard?.write
        ? navigator.clipboard
            .write([new ClipboardItem({ "text/plain": link.then((url) => new Blob([url], { type: "text/plain" })) })])
            .then(() => true)
            .catch(() => false)
        : Promise.resolve(false);
    void Promise.all([link, written]).then(
      async ([url, ok]) => {
        gaEvent("share", { method: "link", content_type: "video", item_id: projectId });
        setState({ kind: "ready", url, copied: ok || (await copy(url)) });
      },
      (e: unknown) => setState({ kind: "error", message: e instanceof Error ? e.message : String(e) })
    );
  };

  const turnOff = () => {
    setState({ kind: "making" });
    api.unshareProject(projectId).then(
      () => setState({ kind: "off" }),
      (e: unknown) => setState({ kind: "error", message: e instanceof Error ? e.message : String(e) })
    );
  };

  return (
    <div className="relative">
      <Button size="sm" variant="secondary" onClick={share} aria-label="Share a link to this video" title="Share a link to this video">
        <Link2 className="size-3.5" /> <span className="hidden sm:inline">Share</span>
      </Button>
      {state.kind !== "closed" && (
        <>
          {/* a tap outside closes it */}
          <button type="button" aria-label="Close" className="fixed inset-0 z-40 cursor-default" onClick={() => setState({ kind: "closed" })} />
          <div
            role="dialog"
            aria-label="Share link"
            className="fixed inset-x-3 top-14 z-50 rounded-xl border border-line bg-panel p-4 text-sm shadow-lg sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-80"
          >
            {state.kind === "making" ? (
              <div className="flex items-center gap-2 text-mute" role="status">
                <Spinner className="size-4 text-accent" /> One moment…
              </div>
            ) : state.kind === "error" ? (
              <ErrorBanner message={state.message} />
            ) : state.kind === "off" ? (
              <p className="text-mute" role="status">
                Link turned off. Anyone who opens it now sees that it doesn&apos;t work.
              </p>
            ) : (
              <>
                <p className="flex items-center gap-1.5 font-medium text-fg" role="status">
                  {state.copied ? (
                    <>
                      <Check className="size-4 text-ok" /> Link copied
                    </>
                  ) : (
                    "Copy this link"
                  )}
                </p>
                <p className="mt-1 text-[13px] leading-relaxed text-mute">Anyone with the link can watch this video. They don&apos;t need an account.</p>
                <div className="mt-3 flex items-center gap-2 rounded-lg border border-line bg-bg px-2.5 py-1.5">
                  <input readOnly value={state.url} onFocus={(e) => e.currentTarget.select()} aria-label="Share link" className="min-w-0 flex-1 bg-transparent font-mono text-xs text-fg outline-none" />
                  <button
                    type="button"
                    aria-label="Copy"
                    className="shrink-0 cursor-pointer rounded-md p-1.5 text-mute hover:bg-panel-hi hover:text-fg"
                    onClick={() => {
                      const url = state.url;
                      void copy(url).then((ok) => setState({ kind: "ready", url, copied: ok }));
                    }}
                  >
                    {state.copied ? <Check className="size-4 text-ok" /> : <Copy className="size-4" />}
                  </button>
                </div>
                <button type="button" onClick={turnOff} className="mt-3 cursor-pointer text-[13px] text-mute underline-offset-2 hover:text-fg hover:underline">
                  Turn off this link
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
