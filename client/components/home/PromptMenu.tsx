"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ImagePlus, Plus, RectangleHorizontal, RectangleVertical } from "lucide-react";

import { MAX_REFERENCES, type useReferences } from "@/components/References";
import { cn } from "@/components/ui";
import type { Aspect } from "@/lib/api";

type Refs = ReturnType<typeof useReferences>;

const SHAPES: Array<{ id: Aspect; name: string; hint: string; Icon: typeof RectangleHorizontal }> = [
  { id: "16:9", name: "Landscape", hint: "Websites, YouTube, X", Icon: RectangleHorizontal },
  { id: "9:16", name: "Vertical", hint: "Reels, Shorts, TikTok", Icon: RectangleVertical },
];

/** One row of the menu: an icon, a name and what it is for. */
function Item({
  Icon,
  name,
  hint,
  selected,
  disabled,
  onClick,
  role = "menuitem",
}: {
  Icon: typeof Plus;
  name: React.ReactNode;
  hint: string;
  selected?: boolean;
  disabled?: boolean;
  onClick: () => void;
  role?: "menuitem" | "menuitemradio" | "menuitemcheckbox";
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={role === "menuitem" ? undefined : !!selected}
      disabled={disabled}
      onClick={onClick}
      className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-panel-hi disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
    >
      <Icon className="size-4 shrink-0 text-mute" />
      <span className="flex-1">
        <span className="block text-fg">{name}</span>
        <span className="block text-xs text-dim">{hint}</span>
      </span>
      {selected && <Check className="size-4 shrink-0 text-mute" />}
    </button>
  );
}

/** The prompt bar's "+": add reference images, choose the video's shape (home and the project's chat). */
export function PromptMenu({
  refs,
  aspect,
  onAspect,
  disabled,
  up = false,
}: {
  refs: Refs;
  aspect: Aspect;
  /** Leave out where the shape is already set (a made video): the shapes are shown, not chosen. */
  onAspect?: (a: Aspect) => void;
  disabled?: boolean;
  /** Open above the button (the chat's bar sits at the bottom). */
  up?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const full = refs.items.length >= MAX_REFERENCES;

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

  return (
    <div ref={box} className="relative">
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) void refs.add(e.target.files);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Add images or change the video shape"
        title="Add images, video shape"
        className={cn(
          "grid size-8 cursor-pointer place-items-center rounded-lg text-mute transition-colors hover:bg-panel-hi hover:text-fg disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent",
          open && "bg-panel-hi text-fg"
        )}
      >
        <Plus className={cn("size-5 transition-transform", open && "rotate-45")} />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Add to your video"
          className={cn("absolute left-0 z-50 w-72 rounded-xl border border-line bg-panel p-1 text-left shadow-[0_20px_60px_-24px_rgba(0,0,0,0.55)]", up ? "bottom-10" : "top-10")}
        >
          <Item
            Icon={ImagePlus}
            name="Add images"
            hint={full ? `Up to ${MAX_REFERENCES} images: remove one to add another` : `Screenshots or a style to match (up to ${MAX_REFERENCES})`}
            disabled={full}
            onClick={() => {
              setOpen(false);
              input.current?.click();
            }}
          />
          <div className="mx-3 my-1 border-t border-line" />
          <div className="px-3 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-dim">Video shape{onAspect ? "" : " (set when the video was made)"}</div>
          {SHAPES.map(({ id, name, hint, Icon }) => (
            <Item
              key={id}
              role="menuitemradio"
              Icon={Icon}
              name={
                <>
                  {name} <span className="font-mono text-xs text-dim">{id}</span>
                </>
              }
              hint={hint}
              selected={aspect === id}
              disabled={!onAspect && aspect !== id}
              onClick={() => {
                onAspect?.(id);
                setOpen(false);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
