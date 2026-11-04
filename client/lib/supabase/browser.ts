"use client";

import { createBrowserClient } from "@supabase/ssr";

/** Supabase in the browser: sign-in and sign-out only; data goes through /api. */
export const supabaseBrowser = () =>
  createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);

export const authEnabled = (): boolean => !!process.env.NEXT_PUBLIC_SUPABASE_URL;
