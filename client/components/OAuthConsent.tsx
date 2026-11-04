"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { OAuthAuthorizationDetails } from "@supabase/supabase-js";

import { Scene } from "@/components/Scene";
import { Button, ErrorBanner, Spinner } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/browser";

/**
 * Approve or deny an app (Claude, another MCP client) that asks to use XLaunch as the signed-in
 * user. Supabase Auth's OAuth server sends the user here with an authorization_id; the proxy has
 * already sent a signed-out visitor to sign in and back. Approving returns the app its code.
 */
export function OAuthConsent() {
  const id = useSearchParams().get("authorization_id");
  const [details, setDetails] = useState<OAuthAuthorizationDetails | null>(null);
  const [error, setError] = useState<string | null>(id ? null : "This link is missing its authorization request. Start connecting again from the app.");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    void supabaseBrowser()
      .auth.oauth.getAuthorizationDetails(id)
      .then(({ data, error: failed }) => {
        if (!alive) return;
        if (failed || !data) return setError(failed?.message ?? "This authorization request is no longer valid. Start connecting again.");
        // approved before: straight back to the app
        if (!("authorization_id" in data)) return window.location.assign(data.redirect_url);
        setDetails(data);
      });
    return () => {
      alive = false;
    };
  }, [id]);

  const decide = async (approve: boolean) => {
    if (!id) return;
    setBusy(true);
    const oauth = supabaseBrowser().auth.oauth;
    const { data, error: failed } = approve ? await oauth.approveAuthorization(id) : await oauth.denyAuthorization(id);
    if (failed || !data) {
      setBusy(false);
      return setError(failed?.message ?? "That didn't go through. Try again.");
    }
    window.location.assign(data.redirect_url);
  };

  const host = (() => {
    try {
      return details ? new URL(details.redirect_uri).host : "";
    } catch {
      return details?.redirect_uri ?? "";
    }
  })();

  return (
    <div data-mode="2d" className="relative grid min-h-screen place-items-center overflow-hidden px-5 py-12">
      <Scene />
      <main className="relative z-10 w-full max-w-[440px] rounded-2xl bg-panel/95 p-7 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.75)] ring-1 ring-line">
        <img src="/logo/icon.png" alt="" width={40} height={40} className="size-10 rounded-[24%]" />
        {error ? (
          <div className="mt-5">
            <ErrorBanner message={error} />
          </div>
        ) : !details ? (
          <div className="mt-6 flex items-center gap-2 text-sm text-mute">
            <Spinner className="size-4" /> Loading the request…
          </div>
        ) : (
          <>
            <h1 className="mt-5 text-[22px] font-medium tracking-tight text-fg">Connect {details.client.name || "this app"} to XLaunch</h1>
            <p className="mt-2 text-sm leading-relaxed text-mute">
              It will act as <span className="font-medium text-fg">{details.user.email}</span> and can:
            </p>
            <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-mute">
              <li>make, change, export and stop your videos</li>
              <li>spend your credits on them</li>
              <li>see your videos and credit balance</li>
            </ul>
            <p className="mt-4 text-xs leading-relaxed text-dim">
              It can&apos;t make API keys or change how you sign in. Only approve apps you trust; you can disconnect it later in Claude. After you approve, you&apos;ll go back to{" "}
              <span className="font-mono text-mute">{host}</span>.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="ghost" disabled={busy} onClick={() => void decide(false)}>
                Deny
              </Button>
              <Button variant="primary" loading={busy} onClick={() => void decide(true)}>
                Approve
              </Button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
