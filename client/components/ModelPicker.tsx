"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, Lock, Mic, X } from "lucide-react";

import { api, type ModelOption, type Models } from "@/lib/api";
import type { Effort } from "@/lib/types";
import { cn } from "@/components/ui";

/** The pick is remembered for the visit; 2D and 3D films offer the same models. */
const STORAGE_KEY = "xlaunch:model";

let cache: Promise<Models> | null = null;
const loadModels = () => {
  cache ??= api.models().catch((e) => {
    cache = null;
    throw e;
  });
  return cache;
};

/** The models on offer, once loaded (null until then). */
function useModels(): Models | null {
  const [loaded, setLoaded] = useState<Models | null>(null);
  useEffect(() => {
    let alive = true;
    loadModels()
      .then((r) => alive && setLoaded(r))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return loaded;
}

/**
 * A pick lasts for the visit (this tab), so every new visit starts on the
 * server's default model (Sonnet 5.5) rather than on a model chosen once for
 * one video. Picks kept for good by older versions are cleared.
 */
const remembered = (): string | null => {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem("xlaunch:model-3d");
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

/**
 * The models on offer and the one in use: what was picked here, else
 * `initial` (a project's model), the viewer's last pick, then the server
 * default. Also the free preview's model (what a free account's film is made with).
 */
export function useModel(initial?: string): [string | null, (id: string) => void, ModelOption[], ModelOption | null] {
  const loaded = useModels();
  const [picked, setPicked] = useState<string | null>(null);
  const list = loaded?.models ?? [];
  const ok = (id: string | null | undefined): id is string => !!id && list.some((m) => m.id === id);
  const stored = typeof window === "undefined" || !loaded ? null : remembered();
  const model = !loaded ? (initial ?? null) : ok(picked) ? picked : ok(initial) ? initial : ok(stored) ? stored : loaded.default;

  const choose = (id: string) => {
    setPicked(id);
    try {
      window.sessionStorage.setItem(STORAGE_KEY, id);
    } catch {
      // private window or blocked storage: the choice just isn't remembered
    }
  };
  return [model, choose, list, loaded?.preview ?? null];
}

/** The effort levels Opus 5.5 can work at (Sonnet 5.5 always works at high). */
const EFFORTS: Array<{ id: Effort; label: string; hint: string }> = [
  { id: "low", label: "Low", hint: "Fastest; thinks least" },
  { id: "medium", label: "Medium", hint: "Balanced" },
  { id: "high", label: "High", hint: "Slowest; thinks most, uses more credits" },
];
const EFFORT_KEY = "xlaunch:effort";

export type EffortState = { effort: Effort | null; setEffort: (id: Effort) => void; shown: boolean };

/**
 * The effort a model works at, for a model that lets it be picked (Opus 5.5,
 * `chooseEffort`): the viewer's last pick, else the project's, else the
 * server's default (high). `shown` is false for any other model (Sonnet 5.5
 * always works at high), and no effort is sent for it.
 */
export function useEffort(model: string | null, initial?: string): EffortState {
  const loaded = useModels();
  const [picked, setPicked] = useState<string | null>(null);
  const ok = (id: string | null | undefined): id is Effort => !!id && EFFORTS.some((e) => e.id === id);
  let stored: string | null = null;
  try {
    stored = typeof window === "undefined" ? null : window.localStorage.getItem(EFFORT_KEY);
  } catch {
    stored = null;
  }
  const fallback = loaded?.effort ?? "high";
  const effort = ok(picked) ? picked : ok(initial) ? initial : ok(stored) ? stored : ok(fallback) ? fallback : null;
  const setEffort = (id: Effort) => {
    setPicked(id);
    try {
      window.localStorage.setItem(EFFORT_KEY, id);
    } catch {
      // private window or blocked storage: the choice just isn't remembered
    }
  };
  return { effort, setEffort, shown: !!loaded?.models.find((m) => m.id === model)?.chooseEffort };
}

/** What each model is for, under its name in the menu. */
const DESCRIPTIONS: Record<string, string> = {
  "claude-sonnet-5-5": "Strong and quick · always High effort",
  "claude-opus-5-5": "Strongest films · pick its effort",
};

/** "Claude Opus 5.5" reads "Opus 5.5" in the button and the menu. */
const short = (label: string) => label.replace(/^Claude\s+/, "");

/** Narration: on by default for a new video; a made video starts from its own setting. */
export type NarrationState = { on: boolean; set: (on: boolean) => void; credits?: number };
export function useNarration(initial?: boolean, credits?: number): NarrationState {
  const [on, set] = useState(initial ?? true);
  return { on, set, credits };
}

/** The capsule in a prompt bar while narration is on: says so, and turns it off. */
export function NarrationChip({ narration, disabled }: { narration?: NarrationState; disabled?: boolean }) {
  if (!narration?.on) return null;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => narration.set(false)}
      title={`Narration on${narration.credits ? ` · about ${narration.credits} credits` : ""} · click to turn it off`}
      aria-label="Narration on. Turn it off"
      className="group flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-full bg-accent/12 px-2.5 text-[12px] font-medium text-accent ring-1 ring-accent/25 transition-colors hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <Mic className="size-3.5" />
      Narration
      <X className="hidden size-3 group-hover:block" />
    </button>
  );
}

/** A small on/off switch. */
function Switch({ on }: { on: boolean }) {
  return (
    <span aria-hidden className={cn("relative h-[18px] w-8 shrink-0 rounded-full transition-colors", on ? "bg-accent" : "bg-line-hi")}>
      <span className={cn("absolute top-0.5 size-3.5 rounded-full bg-white shadow transition-transform", on ? "translate-x-4" : "translate-x-0.5")} />
    </span>
  );
}

const row = "flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-panel-hi";

/**
 * The model and effort menu of a prompt bar: the button shows both
 * ("Opus 5.5  Medium"); the menu lists the models with what each is for, and
 * an Effort row (Opus only) opening a side menu. `locked`: nothing to pick
 * (a free account's preview): the button shows that model at High, greyed,
 * with `locked.title` as its tooltip.
 */
export function ModelMenu({
  value,
  models,
  onChange,
  effort,
  disabled,
  up = true,
  hints,
  narration,
  locked,
}: {
  value: string | null;
  models: ModelOption[];
  onChange: (id: string) => void;
  effort: EffortState;
  disabled?: boolean;
  /** Open the menu above the button (the chat's bar sits at the bottom). */
  up?: boolean;
  /** A line under each model (its typical cost), by model id. */
  hints?: Record<string, string>;
  /** The narration switch at the bottom of the menu. */
  narration?: NarrationState;
  /** The model the film is made with whatever is picked, and why (a free preview). */
  locked?: { model: ModelOption; title: string };
}) {
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState<"effort" | null>(null);
  const box = useRef<HTMLDivElement>(null);
  // Hovering a row opens (or closes) the side menu only after a moment, and the side menu cancels it when
  // the pointer reaches it: the way over to it may cross another row without the menu going away.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hold = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const later = (next: "effort" | null) => {
    hold();
    timer.current = setTimeout(() => setSide(next), 180);
  };
  const now = (next: "effort" | null) => {
    hold();
    setSide(next);
  };
  useEffect(() => hold, []);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (side) setSide(null);
      else setOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open, side]);

  if (locked) {
    return (
      <button
        type="button"
        disabled
        aria-label={`Model: ${short(locked.model.label)}, High effort. ${locked.title}`}
        title={locked.title}
        className="flex h-8 max-w-full cursor-not-allowed items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-[13px] text-mute"
      >
        <Lock className="size-3.5 shrink-0" />
        <span className="min-w-0 truncate">{short(locked.model.label)} · High</span>
      </button>
    );
  }

  const current = models.find((m) => m.id === value);
  if (!current) return null;
  const effortLabel = effort.shown ? EFFORTS.find((e) => e.id === effort.effort)?.label : undefined;
  // only one model and nothing to set: shown, not chosen
  if (models.length === 1 && !effort.shown && !narration) {
    return (
      <span title={`Made by ${current.label}${hints?.[current.id] ? ` · ${hints[current.id]}` : ""}`} className="flex h-8 items-center px-2 text-xs text-mute">
        {short(current.label)}
      </span>
    );
  }

  // one line under the name: what it is for, and its typical cost ("~71 credits for a 30 s video" → "~71 credits")
  const sub = (m: ModelOption) => [DESCRIPTIONS[m.id] ?? "", hints?.[m.id]?.replace(/\s+for a .*$/, "")].filter(Boolean).join(" · ");
  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
    setSide(null);
  };
  const panel = "rounded-xl border border-line bg-panel p-1 text-left text-fg shadow-[0_20px_60px_-24px_rgba(0,0,0,0.55)]";

  return (
    <div ref={box} className="relative min-w-0">
      <button
        type="button"
        onClick={() => {
          setOpen(!open);
          setSide(null);
        }}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Model: ${current.label}${effortLabel ? `, ${effortLabel} effort` : ""}`}
        title={current.label}
        className="flex h-8 max-w-full cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-[13px] text-fg transition-colors hover:bg-panel-hi disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
      >
        <span className="min-w-0 truncate">{short(current.label)}</span>
        {effortLabel && <span className="shrink-0 text-mute">{effortLabel}</span>}
        <ChevronDown className={cn("size-3.5 shrink-0 text-mute transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className={cn(panel, "absolute right-0 z-50 w-64", up ? "bottom-10" : "top-10")}>
          <ul role="listbox" aria-label="Model">
            {models.map((m) => (
              <li key={m.id}>
                {/* a row in the main menu closes an open side menu */}
                <button type="button" role="option" aria-selected={m.id === value} onClick={() => pick(m.id)} onMouseEnter={() => later(null)} className={row}>
                  <span className="min-w-0">
                    <span className="block text-[13.5px]">{short(m.label)}</span>
                    {sub(m) && <span className="block text-[12px] leading-snug text-dim">{sub(m)}</span>}
                  </span>
                  {m.id === value && <Check className="size-4 shrink-0 text-mute" />}
                </button>
              </li>
            ))}
          </ul>

          {effort.shown && (
            <>
              <div className="mx-2 my-1 h-px bg-line" />
              <div className="relative">
                <button type="button" aria-haspopup="menu" aria-expanded={side === "effort"} onClick={() => now(side === "effort" ? null : "effort")} onMouseEnter={() => later("effort")} className={row}>
                  <span className="text-[13.5px]">Effort</span>
                  <span className="flex items-center gap-1 text-[12px] text-mute">
                    {effortLabel}
                    <ChevronRight className="size-4" />
                  </span>
                </button>
                {side === "effort" && (
                  <div onMouseEnter={hold} className={cn("absolute right-full z-50 pr-1.5", up ? "bottom-0" : "top-0")}>
                    <ul role="listbox" aria-label="Effort" className={cn(panel, "w-56")}>
                      {EFFORTS.map((e) => (
                        <li key={e.id}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={e.id === effort.effort}
                            onClick={() => {
                              effort.setEffort(e.id);
                              setSide(null);
                            }}
                            className={row}
                          >
                            <span className="min-w-0">
                              <span className="block text-[13.5px]">{e.label}</span>
                              <span className="block text-[12px] leading-snug text-dim">{e.hint}</span>
                            </span>
                            {e.id === effort.effort && <Check className="size-4 shrink-0 text-mute" />}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </>
          )}

          {narration && (
            <>
              <div className="mx-2 my-1 h-px bg-line" />
              <button
                type="button"
                role="switch"
                aria-checked={narration.on}
                onClick={() => narration.set(!narration.on)}
                onMouseEnter={() => later(null)}
                className={row}
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-[13.5px]">
                    <Mic className="size-3.5 text-mute" />
                    Narration
                  </span>
                  <span className="block text-[12px] leading-snug text-dim">
                    A voice tells the story{narration.credits ? ` · ~${narration.credits} credits` : ""}
                  </span>
                </span>
                <Switch on={narration.on} />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
