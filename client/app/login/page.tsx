"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Mail, Sparkles } from "lucide-react";

import { Scene } from "@/components/Scene";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button, ErrorBanner, Input } from "@/components/ui";
import { api, showcasePosterUrl, showcaseVideoUrl, type ShowcaseItem } from "@/lib/api";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useMode, type Mode } from "@/lib/use-mode";
import { peekDraft } from "@/lib/use-signed-in";
import { SIGNIN_SOURCES, track } from "@/lib/funnel";

const RESEND_SECONDS = 60;

const GoogleMark = () => (
  <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
    <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.7z" />
    <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z" />
    <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1z" />
    <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z" />
  </svg>
);

/** Supabase's messages, in words a visitor can act on. */
const friendly = (message: string): string =>
  /provider is not enabled/i.test(message)
    ? "Google sign-in isn't available here yet. Use your email instead."
    : /rate limit|too many/i.test(message)
      ? "Too many sign-in emails in a short time. Wait a few minutes, then try again."
      : message;

/** Examples in the visitor's chosen style, one after another, beside the form. */
function Reel({ mode }: { mode: Mode }) {
  const [all, setAll] = useState<ShowcaseItem[] | null>(null);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    let alive = true;
    api.showcase("login").then(
      (items) => alive && setAll(items),
      () => alive && setAll([])
    );
    return () => {
      alive = false;
    };
  }, []);

  if (!all) return <figure aria-hidden className="hidden aspect-video rounded-2xl bg-black/25 lg:block" />;
  const items = all.filter((i) => i.mode === mode).slice(0, 6);
  const item = items.length ? items[index % items.length]! : null;
  if (!item) return null;
  const tall = item.height > item.width * 1.2;

  return (
    <figure className="rise hidden lg:block">
      <div className="relative aspect-video overflow-hidden rounded-2xl bg-black shadow-[0_30px_80px_-30px_rgba(0,0,0,0.75)] ring-1 ring-white/10">
        {tall && (
          <img src={showcasePosterUrl(item)} alt="" aria-hidden className="absolute inset-0 size-full scale-125 object-cover opacity-50 blur-2xl" />
        )}
        <video
          key={item.id}
          src={showcaseVideoUrl(item)}
          poster={showcasePosterUrl(item)}
          autoPlay
          muted
          playsInline
          onEnded={() => setIndex((i) => i + 1)}
          className={`absolute inset-0 size-full ${tall ? "object-contain" : "object-cover"}`}
        />
      </div>
      <figcaption className="mt-3 flex items-center justify-between text-sm text-[color:var(--hero-fg-mute)]">
        <span>
          Made with XLaunch · <span className="text-[color:var(--hero-fg)]">{item.title}</span>
        </span>
        <span className="flex gap-1.5" aria-hidden>
          {items.map((it, i) => (
            <button
              key={it.id}
              tabIndex={-1}
              onClick={() => setIndex(i)}
              className={`h-1.5 cursor-pointer rounded-full transition-all ${i === index % items.length ? "w-5 bg-[color:var(--hero-fg)]" : "w-1.5 bg-[color:var(--hero-fg-mute)] opacity-60"}`}
            />
          ))}
        </span>
      </figcaption>
    </figure>
  );
}

function LoginForm() {
  const params = useSearchParams();
  const next = params.get("next") ?? "/";
  const [mode] = useMode();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<"email" | "google" | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(params.get("error"));

  useEffect(() => {
    void Promise.resolve().then(() => setDraft(peekDraft()?.prompt ?? null));
    // what opened this page (`?from=`, set by every link and redirect here); none, or one we don't know: the address was opened directly
    const from = params.get("from");
    track("signin_viewed", { source: SIGNIN_SOURCES.find((s) => s === from) ?? "direct" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = window.setTimeout(() => setWait((w) => w - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [wait]);

  const callback = () => `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

  const withGoogle = async () => {
    setBusy("google");
    setError(null);
    const { error } = await supabaseBrowser().auth.signInWithOAuth({ provider: "google", options: { redirectTo: callback() } });
    if (error) {
      setError(friendly(error.message));
      setBusy(null);
    }
  };

  const sendLink = async (to: string) => {
    setBusy("email");
    setError(null);
    const { error } = await supabaseBrowser().auth.signInWithOtp({ email: to, options: { emailRedirectTo: callback() } });
    setBusy(null);
    if (error) return setError(friendly(error.message));
    setSentTo(to);
    setWait(RESEND_SECONDS);
  };

  return (
    <div data-mode={mode} className="relative min-h-screen overflow-x-hidden">
      <Scene />

      <header className="relative z-20 flex items-center justify-between px-5 pt-4">
        <Link href="/" className="group flex items-center gap-2 text-sm font-medium text-[color:var(--hero-fg)]">
          <ArrowLeft className="size-4 opacity-70 transition-transform group-hover:-translate-x-0.5" />
          <img src="/logo/icon.png" alt="" width={28} height={28} className="size-7 shrink-0 rounded-[24%]" />
          XLaunch
        </Link>
        <ThemeToggle onHero />
      </header>

      <div className="relative z-10 mx-auto grid min-h-[calc(100svh-64px)] w-full max-w-[1120px] items-center gap-12 px-5 py-10 lg:has-[figure]:grid-cols-[400px_1fr]">
        <main className="rise mx-auto w-full max-w-[400px] rounded-2xl bg-panel p-7 shadow-[0_20px_60px_-24px_rgba(0,0,0,0.55)]">
          {sentTo ? (
            <div aria-live="polite">
              <span className="grid size-11 place-items-center rounded-full bg-accent/12 text-accent">
                <Mail className="size-5" />
              </span>
              <h1 className="mt-5 text-xl font-medium tracking-tight">Check your inbox</h1>
              <p className="mt-1.5 text-sm leading-relaxed text-mute">
                We sent a sign-in link to <span className="font-medium text-fg">{sentTo}</span>. Open it on this device to continue. The link
                works once.
              </p>
              <div className="mt-6 flex flex-col gap-2">
                <Button variant="secondary" size="lg" onClick={() => void sendLink(sentTo)} loading={busy === "email"} disabled={busy !== null || wait > 0}>
                  {wait > 0 ? `Resend in ${wait}s` : "Resend the link"}
                </Button>
                <Button
                  variant="ghost"
                  size="lg"
                  onClick={() => {
                    setSentTo(null);
                    setError(null);
                  }}
                >
                  Use a different email
                </Button>
              </div>
            </div>
          ) : (
            <>
              <h1 className="text-2xl font-medium tracking-tight">Sign in to XLaunch</h1>
              <p className="mt-2 inline-flex items-center rounded-full bg-accent/12 px-2.5 py-1 text-xs font-medium text-accent">Free preview · no card needed</p>
              <p className="mt-2.5 text-sm leading-relaxed text-mute">
                You get your film&rsquo;s storyboard and its voiced opening, ready in about 10 minutes. New here? Signing in creates your account.
              </p>

              {draft && (
                <div className="mt-5 flex gap-3 rounded-xl border border-accent/30 bg-accent/8 px-3.5 py-3 text-sm">
                  <Sparkles className="mt-0.5 size-4 shrink-0 text-accent" />
                  <div className="min-w-0">
                    <div className="font-medium">Your prompt is saved</div>
                    <div className="mt-0.5 truncate text-mute">&ldquo;{draft}&rdquo;</div>
                  </div>
                </div>
              )}

              <Button size="lg" className="mt-6 w-full" onClick={withGoogle} loading={busy === "google"} disabled={busy !== null}>
                {busy !== "google" && <GoogleMark />}
                Continue with Google
              </Button>
              <div className="my-5 flex items-center gap-3 text-xs text-dim">
                <span className="h-px flex-1 bg-line" />
                or with email
                <span className="h-px flex-1 bg-line" />
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (email.trim()) void sendLink(email.trim());
                }}
                className="flex flex-col gap-3"
              >
                <label htmlFor="email" className="sr-only">
                  Email
                </label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  autoFocus
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-10"
                  required
                />
                <Button type="submit" variant="primary" size="lg" loading={busy === "email"} disabled={busy !== null}>
                  Email me a sign-in link
                </Button>
              </form>
            </>
          )}
          {error && (
            <div className="mt-4">
              <ErrorBanner message={error} />
            </div>
          )}
          <p className="mt-6 text-xs leading-relaxed text-dim">
            By continuing you agree to the{" "}
            <Link href="/terms" className="underline hover:text-fg">
              Terms
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="underline hover:text-fg">
              Privacy Policy
            </Link>
            .
          </p>
        </main>

        <Reel mode={mode} />
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
