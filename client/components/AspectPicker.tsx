"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, RectangleHorizontal, RectangleVertical } from "lucide-react";

import { cn } from "@/components/ui";
import type { Aspect } from "@/lib/api";

const STORAGE_KEY = "xlaunch:aspect";

const OPTIONS: Array<{ id: Aspect; name: string; hint: string; Icon: typeof RectangleHorizontal }> = [
  { id: "16:9", name: "Landscape", hint: "Websites, YouTube, X", Icon: RectangleHorizontal },
  { id: "9:16", name: "Vertical", hint: "Reels, Shorts, TikTok", Icon: RectangleVertical },
];

/** The video shape for a new project: the viewer's last pick, else landscape. */
export function useAspect(): [Aspect, (a: Aspect) => void] {
  const [aspect, setAspect] = useState<Aspect>("16:9");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === "9:16" || saved === "16:9") void Promise.resolve().then(() => setAspect(saved));
    } catch {
      // blocked storage: landscape
    }
  }, []);
  const choose = (a: Aspect) => {
    setAspect(a);
    try {
      window.localStorage.setItem(STORAGE_KEY, a);
    } catch {
      // the choice just isn't remembered
    }
  };
  return [aspect, choose];
}

/** A compact shape chip for a prompt bar: the current shape, a menu of both. */
export function AspectPicker({ value, onChange, disabled, up = false }: { value: Aspect; onChange: (a: Aspect) => void; disabled?: boolean; up?: boolean }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  const current = OPTIONS.find((o) => o.id === value) ?? OPTIONS[0]!;
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Video shape: ${current.name} ${current.id}`}
        className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-xs text-mute transition-colors hover:bg-panel-hi hover:text-fg disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
      >
        <current.Icon className="size-4" />
        <span className="font-mono tabular-nums">{current.id}</span>
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label="Video shape"
          className={cn(
            "absolute left-0 z-50 w-60 rounded-xl border border-line bg-panel p-1 text-left text-fg shadow-[0_20px_60px_-24px_rgba(0,0,0,0.55)]",
            up ? "bottom-10" : "top-10"
          )}
        >
          {OPTIONS.map(({ id, name, hint, Icon }) => (
            <li key={id}>
              <button
                type="button"
                role="option"
                aria-selected={id === value}
                onClick={() => {
                  onChange(id);
                  setOpen(false);
                }}
                className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-panel-hi"
              >
                <Icon className="size-4 shrink-0 text-mute" />
                <span className="flex-1">
                  <span className="block">
                    {name} <span className="font-mono text-xs text-dim">{id}</span>
                  </span>
                  <span className="block text-xs text-dim">{hint}</span>
                </span>
                {id === value && <Check className="size-4 shrink-0 text-mute" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
