"use client";

import { Box, Square } from "lucide-react";

import { cn } from "@/components/ui";
import type { Mode } from "@/lib/use-mode";

const OPTIONS: Array<{ mode: Mode; label: string; Icon: typeof Box; beta?: boolean }> = [
  { mode: "2d", label: "2D", Icon: Square },
  { mode: "3d", label: "3D", Icon: Box, beta: true },
];

/** The 2D / 3D switch: a pill with a sliding thumb. */
export function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (mode: Mode) => void }) {
  const shown = OPTIONS;
  const n = shown.length;
  const index = Math.max(0, shown.findIndex((o) => o.mode === mode));
  return (
    <div
      role="radiogroup"
      aria-label="Video style"
      style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}
      className="relative grid rounded-full bg-panel/80 p-1 text-sm shadow-[0_8px_24px_-12px_rgba(0,0,0,0.5)] ring-1 ring-line backdrop-blur"
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          const step = e.key === "ArrowRight" ? 1 : n - 1;
          onChange(shown[(index + step) % n].mode);
        }
      }}
    >
      <span
        aria-hidden
        style={{ width: `calc(100% / ${n} - 4px)`, transform: `translateX(${index * 100}%)` }}
        className="absolute inset-y-1 left-1 rounded-full bg-fg transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
      />
      {shown.map(({ mode: m, label, Icon, beta }) => (
        <button
          key={m}
          role="radio"
          aria-checked={mode === m}
          tabIndex={mode === m ? 0 : -1}
          onClick={() => onChange(m)}
          className={cn(
            "relative z-10 flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-full px-4 font-medium transition-colors duration-300",
            mode === m ? "text-bg" : "text-mute hover:text-fg"
          )}
        >
          <Icon className="size-3.5" strokeWidth={2.25} />
          {label}
          {beta && <span className="rounded-full px-1.5 py-px text-[9px] font-semibold uppercase leading-none tracking-wider ring-1 ring-current opacity-75">Beta</span>}
        </button>
      ))}
    </div>
  );
}
