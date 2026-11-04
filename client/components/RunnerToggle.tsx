"use client";

import { useSyncExternalStore } from "react";

import { cn } from "@/components/ui";
import type { MotionRunner } from "@/lib/types";

const STORAGE_KEY = "xlaunch:motion-runner";

const OPTIONS: Array<{ id: MotionRunner; label: string; hint: string }> = [
  { id: "claude-code", label: "Subscription", hint: "Runs on the signed-in subscription: no API credits" },
  { id: "api", label: "API", hint: "Runs on the API key, billed per token" },
];

const listeners = new Set<() => void>();
const read = (): MotionRunner => {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "api" ? "api" : "claude-code";
  } catch {
    return "claude-code";
  }
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const choose = (r: MotionRunner) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, r);
  } catch {
    // the choice just isn't remembered
  }
  for (const l of listeners) l();
};

/** How a new motion film's agent signs in: the viewer's last pick, else the Claude Code login. */
export function useRunner(): [MotionRunner, (r: MotionRunner) => void] {
  return [useSyncExternalStore(subscribe, read, () => "claude-code"), choose];
}

/** Claude Code / API: the same agent, signed in one way or the other. */
export function RunnerToggle({ value, onChange, disabled }: { value: MotionRunner; onChange: (r: MotionRunner) => void; disabled?: boolean }) {
  return (
    <div className="flex h-9 items-center rounded-lg bg-panel-hi p-0.5 text-[12px]" role="radiogroup" aria-label="Run the film with">
      {OPTIONS.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          title={o.hint}
          disabled={disabled}
          onClick={() => onChange(o.id)}
          className={cn(
            "h-full cursor-pointer rounded-md px-2.5 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
            value === o.id ? "bg-panel text-fg shadow-sm" : "text-mute hover:text-fg"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
