"use client";

import { useSyncExternalStore } from "react";

/** The home page's choice. A 2D video is made by the film agent (mode "motion" on the server) unless the scene films are on. */
export type Mode = "2d" | "3d";

const KEY = "xlaunch-mode";
const listeners = new Set<() => void>();

const read = (): Mode => {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === "3d" ? "3d" : "2d";
  } catch {
    return "2d";
  }
};

let current: Mode | null = null;
const snapshot = (): Mode => (current ??= read());

export const setMode = (next: Mode): void => {
  current = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // the choice still holds for this visit
  }
  for (const l of listeners) l();
};

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The home page's 2D / 3D choice, remembered in this browser. */
export function useMode(): [Mode, (mode: Mode) => void] {
  return [useSyncExternalStore(subscribe, snapshot, () => "2d"), setMode];
}
