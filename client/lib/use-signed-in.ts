"use client";

import { useEffect, useSyncExternalStore } from "react";

import { clearAccount, ownAccount } from "@/lib/account";
import type { ReferenceImage } from "@/lib/api";
import { authEnabled, supabaseBrowser } from "@/lib/supabase/browser";

/**
 * Who is signed in, shared by every component: read once from Supabase (its
 * own local storage, no network) and kept for the page, so moving between
 * pages shows the account badge straight away. `signedIn` is null while
 * checking; always true without sign-in configured (local mode).
 */
type Session = { signedIn: boolean | null; email: string | null };

const LOCAL: Session = { signedIn: true, email: null };
const CHECKING: Session = { signedIn: null, email: null };
let session: Session = authEnabled() ? CHECKING : LOCAL;
let started = false;
const listeners = new Set<() => void>();

const apply = (email: string | null | undefined, signedIn: boolean) => {
  if (signedIn) ownAccount(email ?? null);
  else clearAccount();
  if (session.signedIn === signedIn && session.email === (email ?? null)) return;
  session = { signedIn, email: email ?? null };
  listeners.forEach((l) => l());
};

const start = () => {
  if (started || !authEnabled()) return;
  started = true;
  const supabase = supabaseBrowser();
  void supabase.auth.getSession().then(({ data }) => apply(data.session?.user.email, !!data.session));
  supabase.auth.onAuthStateChange((_event, s) => apply(s?.user.email, !!s));
};

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useSession(): Session {
  const s = useSyncExternalStore(
    subscribe,
    () => session,
    () => (authEnabled() ? CHECKING : LOCAL)
  );
  useEffect(start, []);
  return s;
}

/** Whether someone is signed in: null while checking. */
export const useSignedIn = (): boolean | null => useSession().signedIn;

const DRAFT = "xlaunch-draft";
const DRAFT_TTL_MS = 60 * 60 * 1000;

/**
 * What was set up before signing in: the prompt and the choices that aren't
 * remembered elsewhere (mode, shape and effort are), so it can be generated
 * as asked as soon as sign-in comes back.
 */
export type Draft = { prompt: string; narration: boolean; model?: string; references: ReferenceImage[] };

/** Kept until sign-in comes back (often in a new tab, from the email link). Images that don't fit in storage are dropped, not the prompt. */
export const saveDraft = (draft: Draft): void => {
  try {
    localStorage.setItem(DRAFT, JSON.stringify({ ...draft, at: Date.now() }));
  } catch {
    try {
      localStorage.setItem(DRAFT, JSON.stringify({ ...draft, references: [], at: Date.now() }));
    } catch {
      // storage blocked: the prompt is typed again
    }
  }
};

/** The saved draft, without clearing it (the sign-in page mentions it). */
export const peekDraft = (): Draft | null => {
  try {
    const raw = localStorage.getItem(DRAFT);
    const draft = raw ? (JSON.parse(raw) as Partial<Draft> & { at?: unknown }) : null;
    if (!draft || typeof draft.prompt !== "string" || typeof draft.at !== "number" || Date.now() - draft.at >= DRAFT_TTL_MS) return null;
    return {
      prompt: draft.prompt,
      narration: draft.narration !== false,
      ...(typeof draft.model === "string" ? { model: draft.model } : {}),
      references: Array.isArray(draft.references) ? draft.references.filter((r) => typeof r?.data === "string" && typeof r?.type === "string") : [],
    };
  } catch {
    return null;
  }
};

/** The saved draft, once: reading it clears it. */
export const takeDraft = (): Draft | null => {
  const draft = peekDraft();
  try {
    localStorage.removeItem(DRAFT);
  } catch {
    // nothing to clear
  }
  return draft;
};
