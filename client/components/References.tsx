"use client";

import { useRef, useState } from "react";
import { Plus, X } from "lucide-react";

import type { ReferenceImage } from "@/lib/api";

/** At most this many reference images per message. */
export const MAX_REFERENCES = 3;
const EDGE = 1600;

type Attached = ReferenceImage & { id: string; name: string; preview: string };

/** Shrink to fit EDGE px and re-encode as JPEG (on white, for transparent PNGs). */
const compress = (file: File): Promise<Attached> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, EDGE / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("This browser can't read images."));
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      const data = canvas.toDataURL("image/jpeg", 0.86);
      resolve({ id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`, name: file.name, type: "image/jpeg", data, preview: data });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`${file.name} isn't an image we can read.`));
    };
    img.src = url;
  });

/** Reference images attached to a prompt: up to MAX_REFERENCES. */
export function useReferences() {
  const [items, setItems] = useState<Attached[]>([]);
  const [error, setError] = useState<string | null>(null);
  const add = async (files: FileList | File[]) => {
    setError(null);
    const images = Array.from(files).filter((f) => f.type.startsWith("image/"));
    const room = MAX_REFERENCES - items.length;
    if (images.length > room) setError(`Up to ${MAX_REFERENCES} images at once.`);
    try {
      const next = await Promise.all(images.slice(0, Math.max(0, room)).map(compress));
      setItems((cur) => [...cur, ...next].slice(0, MAX_REFERENCES));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return {
    items,
    error,
    add,
    remove: (id: string) => {
      setError(null);
      setItems((cur) => cur.filter((i) => i.id !== id));
    },
    clear: () => {
      setError(null);
      setItems([]);
    },
    /** Put back images saved earlier (a draft kept through sign-in). */
    restore: (images: ReferenceImage[]) => {
      setError(null);
      setItems(images.slice(0, MAX_REFERENCES).map((img, i) => ({ ...img, id: `restored-${i}`, name: `Image ${i + 1}`, preview: img.data })));
    },
    /** What the API takes. */
    payload: (): ReferenceImage[] => items.map(({ type, data }) => ({ type, data })),
  };
}

type Refs = ReturnType<typeof useReferences>;

/** The "+" button: opens the file picker, greyed out at the limit. */
export function AttachButton({ refs, disabled, className }: { refs: Refs; disabled?: boolean; className?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const full = refs.items.length >= MAX_REFERENCES;
  return (
    <>
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
        disabled={disabled || full}
        onClick={() => input.current?.click()}
        title={full ? `Up to ${MAX_REFERENCES} images` : `Attach screenshots or references (up to ${MAX_REFERENCES})`}
        aria-label="Attach images"
        className={
          className ??
          "grid size-8 place-items-center rounded-lg text-mute transition-colors hover:bg-raised hover:text-fg disabled:cursor-not-allowed disabled:text-dim disabled:hover:bg-transparent cursor-pointer"
        }
      >
        <Plus className="size-5" />
      </button>
    </>
  );
}

/** The attached images as small thumbnails with a remove button; nothing when empty. */
export function AttachedThumbs({ refs, disabled, className = "" }: { refs: Refs; disabled?: boolean; className?: string }) {
  if (!refs.items.length && !refs.error) return null;
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {refs.items.map((item) => (
        <div key={item.id} className="group relative size-14 shrink-0 overflow-hidden rounded-lg ring-1 ring-line">
          <img src={item.preview} alt={item.name} className="size-full object-cover" />
          {!disabled && (
            <button
              type="button"
              onClick={() => refs.remove(item.id)}
              aria-label={`Remove ${item.name}`}
              className="absolute right-0.5 top-0.5 grid size-5 place-items-center rounded-full bg-black/70 text-white opacity-90 transition-opacity hover:opacity-100 cursor-pointer"
            >
              <X className="size-3" />
            </button>
          )}
        </div>
      ))}
      {refs.error && <span className="text-xs text-bad">{refs.error}</span>}
    </div>
  );
}
