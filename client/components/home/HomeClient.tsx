"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Globe, Play, Sparkles, X } from "lucide-react";

import { ApiError, api } from "@/lib/api";
import type { Costs } from "@/lib/pricing";
import { hasUrl } from "@/lib/url";
import { SavedProjects } from "@/components/SavedProjects";
import { ThemeToggle } from "@/components/ThemeToggle";
import { AccountMenu } from "@/components/AccountMenu";
import { Spinner, cn } from "@/components/ui";
import { ModelMenu, NarrationChip, useEffort, useModel, useNarration } from "@/components/ModelPicker";
import { AttachedThumbs, useReferences } from "@/components/References";
import { AspectPicker, useAspect } from "@/components/AspectPicker";
import { RunnerToggle, useRunner } from "@/components/RunnerToggle";
import { PromptMenu } from "@/components/home/PromptMenu";
import { HeroBadges } from "@/components/home/Badges";
import { ModeToggle } from "@/components/ModeToggle";
import { Scene } from "@/components/Scene";
import { Showcase } from "@/components/Showcase";
import { EXAMPLE_FILMS, FilmDialog, HeroFilm, type ExampleFilm } from "@/components/home/ExampleFilm";
import { useMode, type Mode } from "@/lib/use-mode";
import { saveDraft, takeDraft, useSignedIn } from "@/lib/use-signed-in";
import { loginHref, track, trackVisit } from "@/lib/funnel";
import { useMe } from "@/lib/use-me";

const MAX = 600;

const COPY: Record<Mode, { title: string; lede: string; placeholder: string }> = {
  "2d": {
    title: "Make a launch video",
    lede: "Paste your website: XLaunch designs, animates and reviews an original film for your product. Change anything by asking.",
    placeholder: "Make a launch video for https://yourproduct.com — calm, for designers",
  },
  "3d": {
    title: "Make a 3D launch film",
    lede: "Paste your website: XLaunch builds an original low-poly 3D film for your product, with a camera moving through its world. Change anything by asking.",
    placeholder: "A 3D film for https://yourproduct.com — cinematic, the product floating in space",
  },
};

/** What's typed in "Your website" as an address the server reads (`yourproduct.com` → `https://yourproduct.com`), or null. */
const siteAddress = (text: string): string | null => {
  const raw = text.trim().replace(/^https?:\/\//i, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/\S*)?$/i.test(raw) ? `https://${raw}` : null;
};

/** The interactive top of the home page; `children` (server-rendered sections) follow the examples. */
export function HomeClient({ children }: { children?: ReactNode }) {
  const router = useRouter();
  const [mode, setMode] = useMode();
  const signedIn = useSignedIn();
  const me = useMe(signedIn === true);
  const copy = COPY[mode];
  // 3D is open to accounts the server allows (everyone once ENABLE_3D=1); signed out, Generate leads to sign-in.
  // Only once the account has loaded: until then nothing is known, so nothing is shut.
  const soon = mode === "3d" && signedIn === true && !!me && !me.threeD;
  const [prompt, setPrompt] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  // the free preview this account already has, to go back to (out of credits after using it)
  const [usedPreview, setUsedPreview] = useState<string | null>(null);
  // today's free previews were all taken when this account asked for one
  const [previewsFull, setPreviewsFull] = useState(false);
  // free previews left today across everyone (null until known)
  const [previewsLeft, setPreviewsLeft] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  // a prompt with no address asks for it in place: "Your website", under the prompt
  const [askSite, setAskSite] = useState(false);
  const [site, setSite] = useState("");
  const [siteTried, setSiteTried] = useState(false);
  // an example film playing in the dialog
  const [film, setFilm] = useState<ExampleFilm | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  // 2D and 3D films offer the same models
  const [model, setModel, models, previewModel] = useModel();
  // an account that hasn't bought anything: its free preview is 2D, made with the preview's own model at high effort
  const free = !!me?.free && !me.isAdmin;
  const paidOnly = free && mode === "3d";
  // the model menu is shown but locked for it (unless the account may pick any model)
  const locked = free && !me?.chooseModel && previewModel ? { model: previewModel, title: `Free previews are made with ${previewModel.label}` } : undefined;
  const effort = useEffort(model);
  const [aspect, setAspect] = useAspect();
  const [runner, setRunner] = useRunner();
  // what a film typically costs with each model (public price list), and narration on top
  const [costs, setCosts] = useState<Costs | null>(null);
  const hints: Record<string, string> = {};
  if (costs) {
    for (const m of costs.lineup ?? [...costs.models["2d"], ...costs.models["3d"]]) {
      hints[m.id] = mode === "3d" ? `~${m.film3d.toLocaleString("en-US")} credits for a ${costs.seconds} s 3D film` : `~${m.video.toLocaleString("en-US")} credits for a ${costs.seconds} s video`;
    }
  }
  // the cheapest credit pack, for the offer shown when out of credits (or out of free previews)
  const [packFrom, setPackFrom] = useState<number | null>(null);
  const packPrice = packFrom === null ? null : `$${(packFrom / 100).toFixed(packFrom % 100 ? 2 : 0)}`;
  // a narrated film (on by default): the director writes a voice-over and the scenes follow it
  const narration = useNarration(true, costs?.narration);
  useEffect(() => {
    api
      .pricing()
      .then(({ costs, products }) => {
        setCosts(costs);
        const packs = products.filter((p) => p.kind === "pack").map((p) => p.priceCents);
        setPackFrom(packs.length ? Math.min(...packs) : null);
      })
      .catch(() => undefined);
    api
      .previews()
      .then((r) => setPreviewsLeft(r.left))
      .catch(() => undefined);
  }, []);
  const refs = useReferences();

  // back from sign-in with what was set up before it: put it back, then generate it as asked (once the account and models are known)
  const [resume, setResume] = useState(false);
  const resumed = useRef(false);
  useEffect(() => {
    trackVisit();
    void Promise.resolve().then(() => {
      const draft = takeDraft();
      if (!draft) return;
      setPrompt(draft.prompt);
      narration.set(draft.narration);
      if (draft.model) setModel(draft.model);
      if (draft.references.length) refs.restore(draft.references);
      setResume(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const needsSite = !!prompt.trim() && !hasUrl(prompt);
  const siteUrl = needsSite ? siteAddress(site) : null;
  const showSite = askSite && needsSite;
  // the prompt as sent: the address from "Your website" on its own line when the prompt has none
  const fullPrompt = siteUrl ? `${prompt.trim()}\n${siteUrl}` : prompt.trim();
  const rejected = !prompt.trim() ? "empty" : needsSite && !siteUrl ? "no_url" : null;
  const clientError =
    rejected === "empty"
      ? "Describe your video and include your website URL."
      : rejected === "no_url" && siteTried
        ? site.trim()
          ? "That doesn't look like a web address. Try something like yourproduct.com."
          : "Add your website's address to go on."
        : null;
  const error = serverError ?? (touched ? clientError : null);
  // signed out (or not known yet): the first video is a free preview
  const offerFree = signedIn !== true;
  // the example film beside the composer is for visitors; signed in, the composer gets the whole width (the model menu needs it)
  const sideFilm = signedIn !== true;

  const submit = async (auto = false) => {
    setTouched(true);
    setServerError(null);
    // every press counts (a press while the project is being made is the same one); a resume after sign-in doesn't.
    // A missing address counts once, when "Your website" first appears.
    if (!auto && !busy) {
      track("generate_clicked");
      if (rejected === "empty") track("generate_rejected", { source: "empty" });
      if (rejected === "no_url" && !askSite) track("generate_rejected", { source: "no_url" });
    }
    if (rejected === "no_url" && !busy) {
      // the field focuses itself when it appears; pressed again with it still empty or wrong, say so
      if (askSite) {
        setSiteTried(true);
        document.getElementById("site")?.focus();
      } else setAskSite(true);
      return;
    }
    if (soon || paidOnly || clientError || busy) {
      area.current?.focus();
      return;
    }
    if (signedIn === false) {
      saveDraft({ prompt: fullPrompt, narration: narration.on, model: model ?? undefined, references: refs.payload() });
      router.push(loginHref("generate"));
      return;
    }
    setBusy(true);
    try {
      // only an admin or an account on the server's subscription list chooses how the film agent signs in; everyone else's runs on the API.
      // A locked (free) account sends no effort: its preview runs at high.
      const project = await api.createProject(fullPrompt, model ?? undefined, refs.payload(), mode, aspect, effort.shown && !locked ? (effort.effort ?? undefined) : undefined, narration.on, me?.chooseRunner ? runner : undefined);
      router.push(`/p/${project.id}`);
    } catch (e) {
      setServerError(e instanceof Error ? e.message : String(e));
      setOutOfCredits(e instanceof ApiError && e.code === "credits");
      const full = e instanceof ApiError && e.details.previewsFull === true;
      setPreviewsFull(full);
      if (full) setPreviewsLeft(0);
      setUsedPreview(e instanceof ApiError && typeof e.details.previewProjectId === "string" ? e.details.previewProjectId : null);
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!resume || resumed.current || signedIn !== true || !me || models.length === 0) return;
    resumed.current = true;
    void submit(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resume, signedIn, me, models.length]);

  return (
    <div data-mode={mode} className="relative min-h-screen overflow-x-hidden">
      <Scene />

      <header className="relative z-20 flex items-center justify-between px-5 pt-4">
        <div className="flex items-center gap-2 text-sm font-medium text-[color:var(--hero-fg)]">
          <img src="/logo/icon.png" alt="" width={28} height={28} className="size-7 shrink-0 rounded-[24%]" />
          <span className="hidden sm:inline">XLaunch</span>
        </div>
        <div className="absolute left-1/2 top-4 -translate-x-1/2">
          <ModeToggle mode={mode} onChange={setMode} />
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle onHero />
          <AccountMenu onHero />
        </div>
      </header>

      {/* above "Recently made" (z-10), so the model and prompt menus open over it; below the header (z-20) and its menus.
          Signed out, from lg up the example film sits beside the composer, in the first screen; on a phone it follows the examples. */}
      <section
        className={cn(
          "relative z-[15] mx-auto grid min-h-[82svh] w-full content-center items-center gap-10 px-5 pb-14 pt-10",
          sideFilm ? "max-w-[1240px] lg:grid-cols-[minmax(0,1fr)_minmax(0,480px)] xl:grid-cols-[minmax(0,1fr)_minmax(0,540px)] xl:gap-14" : "max-w-[760px]"
        )}
      >
        <main className={cn("mx-auto w-full max-w-[720px] text-center", sideFilm && "lg:mx-0 lg:text-left")}>
          <HeroBadges className={cn("rise mb-6 justify-center", sideFilm && "lg:justify-start")} />
          <h1
            key={`h-${mode}`}
            className="rise text-balance text-[32px] font-medium leading-[1.12] tracking-tight text-[color:var(--hero-fg)] sm:text-[44px]"
          >
            {copy.title}
            <br />
            from your website.
          </h1>
          <p
            key={`p-${mode}`}
            className={cn("rise mx-auto mt-4 max-w-[480px] text-pretty text-[15px] leading-relaxed text-[color:var(--hero-fg-mute)]", sideFilm && "lg:mx-0")}
          >
            {copy.lede}
          </p>

          <div className="relative z-20 mx-auto mt-8 rounded-2xl bg-panel text-left shadow-[0_20px_60px_-24px_rgba(0,0,0,0.55)]">
            <label htmlFor="prompt" className="sr-only">
              Describe your video
            </label>
            <textarea
              id="prompt"
              ref={area}
              autoFocus
              value={prompt}
              maxLength={MAX}
              placeholder={copy.placeholder}
              aria-invalid={Boolean(error)}
              aria-describedby="prompt-help"
              onChange={(e) => {
                setPrompt(e.target.value);
                setServerError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void submit();
                }
              }}
              onPaste={(e) => {
                const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
                if (files.length) {
                  e.preventDefault();
                  void refs.add(files);
                }
              }}
              className="block h-[132px] w-full resize-none bg-transparent px-5 pb-2 pt-5 text-[15px] leading-relaxed text-fg outline-none placeholder:text-dim"
            />
            <AttachedThumbs refs={refs} disabled={busy} className="px-5 pb-3" />
            {showSite && (
              <div className="mx-3 mb-3 flex items-center gap-2 rounded-lg bg-panel-hi px-3 ring-1 ring-accent/50">
                <Globe className="size-4 shrink-0 text-dim" />
                <label htmlFor="site" className="shrink-0 text-[13px] font-medium text-fg">
                  Your website
                </label>
                <input
                  id="site"
                  autoFocus
                  type="text"
                  inputMode="url"
                  autoComplete="url"
                  autoCapitalize="off"
                  spellCheck={false}
                  placeholder="yourproduct.com"
                  value={site}
                  aria-invalid={Boolean(siteTried && !siteUrl)}
                  aria-describedby="prompt-help"
                  onChange={(e) => {
                    setSite(e.target.value);
                    setSiteTried(false);
                    setServerError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      void submit();
                    }
                  }}
                  className="h-10 min-w-0 flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-dim"
                />
              </div>
            )}
            {/* the tools on the left; the model and Generate stay together on the right, and wrap as one when the row is full (a phone: full width, Generate fills it) */}
            <div className="flex flex-wrap items-center gap-1 px-3 pb-3">
              <PromptMenu refs={refs} aspect={aspect} onAspect={setAspect} disabled={busy} />
              <AspectPicker value={aspect} onChange={setAspect} disabled={busy} />
              <NarrationChip narration={narration} disabled={busy} />
              {me?.chooseRunner && <RunnerToggle value={runner} onChange={setRunner} disabled={busy} />}
              <div className="ml-auto flex w-full min-w-0 items-center justify-end gap-1 sm:w-auto">
                {prompt.length > MAX - 100 && (
                  <span className="mr-1 font-mono text-xs text-dim tabular-nums">
                    {prompt.length}/{MAX}
                  </span>
                )}
                {/* a free account's preview runs on the preview's model at high: shown, locked (signed out: nothing yet) */}
                {signedIn !== false && <ModelMenu value={model} models={models} onChange={setModel} effort={effort} disabled={busy} up={false} hints={hints} narration={narration} locked={locked} />}
                <button
                  onClick={() => void submit()}
                  disabled={busy || soon || paidOnly}
                  title="Enter to generate · Shift + Enter for a new line"
                  className="flex h-10 flex-1 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-fg px-4 text-sm font-medium text-bg transition-all hover:bg-fg/85 active:scale-[0.98] disabled:opacity-60 sm:ml-1 sm:h-9 sm:flex-none"
                >
                  {busy ? <Spinner className="size-4" /> : <Sparkles className="size-4" />}
                  {offerFree ? "Generate free preview" : "Generate"}
                </button>
              </div>
            </div>
          </div>

          {(offerFree || locked) &&
            (previewsLeft === 0 ? (
              <p className="mt-3 text-[13px] text-[color:var(--hero-fg-mute)] lg:text-left">
                <span className="font-medium text-[color:var(--hero-fg)]">Free previews are full today.</span>{" "}
                Get the full film{packPrice ? ` for ${packPrice}` : ""} — refunded within 7 days if it&apos;s not for you.{" "}
                <Link href="/billing" className="font-medium text-accent underline-offset-2 hover:underline">
                  {packPrice ? `Packs from ${packPrice}` : "Get credits"}
                </Link>
              </p>
            ) : (
              <p className="mt-3 text-balance text-[13px] text-[color:var(--hero-fg-mute)] lg:text-left">
                <span className="font-medium text-[color:var(--hero-fg)]">Free preview{previewsLeft !== null ? ` · ${previewsLeft} left today` : ""} · no card needed.</span>{" "}
                Storyboard and opening free; pay only to finish.
              </p>
            ))}

          <div id="prompt-help" role={error ? "alert" : undefined} className="mt-3 min-h-5 text-left text-[13px]">
            {outOfCredits && serverError ? (
              <div className="flex flex-col gap-3 rounded-xl bg-panel/95 p-4 text-sm shadow-[0_10px_30px_-10px_rgba(0,0,0,0.5)] sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-fg">{usedPreview ? "Your free preview is waiting" : previewsFull ? "Free previews are full today" : "Out of credits"}</div>
                  <p className="mt-0.5 text-mute">{serverError}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {usedPreview && (
                    <Link href={`/p/${usedPreview}`} className="rounded-lg bg-fg px-3.5 py-2 font-medium text-bg transition-colors hover:bg-fg/85">
                      Open your preview
                    </Link>
                  )}
                  <Link href="/billing" className={usedPreview ? "text-accent underline-offset-2 hover:underline" : "rounded-lg bg-fg px-3.5 py-2 font-medium text-bg transition-colors hover:bg-fg/85"}>
                    {packPrice ? `Packs from ${packPrice}` : "Get credits"}
                  </Link>
                </div>
              </div>
            ) : error ? (
              <span className="flex items-center gap-2 text-bad">
                <X className="size-3.5 shrink-0" /> {error}
              </span>
            ) : paidOnly ? (
              <span className="flex items-center gap-2 text-[color:var(--hero-fg-mute)]">
                3D videos come with any plan or credit pack. Your free preview is a 2D film.
                <Link href="/billing" className="shrink-0 font-medium text-accent underline-offset-2 hover:underline">
                  Get credits
                </Link>
              </span>
            ) : soon ? (
              <span className="text-[color:var(--hero-fg-mute)]">3D generation opens soon.</span>
            ) : showSite ? (
              <span className="text-[color:var(--hero-fg-mute)]">Which site is the video for? Add its address above and press Generate.</span>
            ) : (
              <span className="sr-only">Include the URL of the product to feature.</span>
            )}
          </div>

          <div className={cn("mt-3 flex flex-wrap items-center justify-center gap-2 text-[13px]", sideFilm && "lg:justify-start")}>
            <span className="text-[color:var(--hero-fg-mute)]">Watch</span>
            {EXAMPLE_FILMS.map((ex) => (
              <button
                key={ex.id}
                type="button"
                onClick={() => setFilm(ex)}
                title={`Play the ${ex.title} launch video made with XLaunch`}
                className="flex min-h-10 cursor-pointer items-center gap-1.5 rounded-full border border-white/25 px-3.5 font-medium text-[color:var(--hero-fg)] transition-colors hover:bg-white/10"
              >
                <Play className="size-3 fill-current" />
                {ex.site}
              </button>
            ))}
          </div>

          {signedIn && (
            <button
              onClick={() => setSaved(true)}
              className="mt-3 rounded-lg bg-panel/95 px-4 py-2 text-sm font-medium text-fg shadow-[0_10px_30px_-10px_rgba(0,0,0,0.5)] transition-transform hover:-translate-y-0.5 active:scale-[0.98] cursor-pointer"
            >
              Open your saved project
            </button>
          )}
        </main>
        {sideFilm && <HeroFilm film={EXAMPLE_FILMS[0]!} onOpen={() => setFilm(EXAMPLE_FILMS[0]!)} className="mx-auto max-w-[560px] lg:max-w-none" />}
      </section>

      {film && <FilmDialog film={film} onClose={() => setFilm(null)} onMake={() => area.current?.focus()} />}

      <Showcase mode={mode} />

      {children}

      {signedIn && <SavedProjects open={saved} onClose={() => setSaved(false)} />}
    </div>
  );
}
