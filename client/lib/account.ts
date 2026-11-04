"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

import { markInternal } from "@/components/Analytics";
import { api, type Billing, type Me } from "@/lib/api";

/**
 * The signed-in account (`/me`) and its credits (`/billing`), shared by every
 * component and kept for the tab (sessionStorage): the account menu, the
 * credits page and the studio read the same copy, so the badge and the
 * balance show at once on the next page and refresh quietly behind it.
 * `undefined` means not loaded yet (show a placeholder); null means it failed.
 */

type State = { owner: string | null; me: Me | null | undefined; billing: Billing | null | undefined };

const KEY = "xlaunch-account";
const FRESH_MS = 30_000;
const EMPTY: State = { owner: null, me: undefined, billing: undefined };

let state: State = EMPTY;
let hydrated = false;
let loading: Promise<void> | null = null;
let loadedAt = 0;
const listeners = new Set<() => void>();

const hydrate = () => {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) state = { ...EMPTY, ...(JSON.parse(raw) as State) };
  } catch {
    // storage blocked or bad JSON: start empty
  }
};

const set = (next: Partial<State>) => {
  state = { ...state, ...next };
  try {
    // a failure (null) is never kept: a request cut off by leaving the page would otherwise stick
    sessionStorage.setItem(KEY, JSON.stringify({ owner: state.owner, me: state.me ?? undefined, billing: state.billing ?? undefined }));
  } catch {
    // storage blocked: kept in memory for this page
  }
  listeners.forEach((l) => l());
};

/** Forget the account (signed out, or someone else signed in). */
export const clearAccount = () => {
  loadedAt = 0;
  set(EMPTY);
};

/** Make sure what is kept belongs to this person (by email): a different one starts empty. */
export const ownAccount = (email: string | null) => {
  hydrate();
  if (email && state.owner && state.owner !== email) clearAccount();
};

/** Load both, once at a time; within FRESH_MS the kept copy is used unless `force`. */
export const loadAccount = (force = false): Promise<void> => {
  hydrate();
  if (loading) return loading;
  if (!force && Date.now() - loadedAt < FRESH_MS) return Promise.resolve();
  loading = Promise.allSettled([
    api.me().then(
      (me) => {
        // an admin's browser stops reporting to Google Analytics from the next page on
        if (me.isAdmin) markInternal();
        set({ me, owner: me.email });
      },
      (e) => {
        set({ me: state.me ?? null });
        throw e;
      }
    ),
    api.billing().then(
      (billing) => set({ billing }),
      (e) => {
        set({ billing: state.billing ?? null });
        throw e;
      }
    ),
  ]).then((results) => {
    // only a full answer counts as fresh; after a failure the next caller asks again
    if (results.every((r) => r.status === "fulfilled")) loadedAt = Date.now();
    loading = null;
  });
  return loading;
};

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => {
  hydrate();
  return state;
};
const serverSnapshot = () => EMPTY;

/** The account and credits; loads them when `enabled` (signed in). */
export function useAccount(enabled = true): State {
  const s = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  useEffect(() => {
    if (enabled) void loadAccount();
  }, [enabled]);
  return s;
}

/** The signed-in account, its limits and this month's usage (null until loaded). */
export const useMe = (enabled = true): Me | null => useAccount(enabled).me ?? null;

/** The caller's credits, what's for sale and what things cost; `refresh` reloads it. */
export function useBilling(): { billing: Billing | null; refresh: () => Promise<Billing | null> } {
  const { billing } = useAccount();
  const refresh = useCallback(async () => {
    try {
      const next = await api.billing();
      set({ billing: next });
      return next;
    } catch {
      return null;
    }
  }, []);
  return { billing: billing ?? null, refresh };
}
