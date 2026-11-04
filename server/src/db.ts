import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The Supabase project (Postgres + Auth). Only this server holds the secret
 * key; the tables have RLS on with no policies (db/001_init.sql), so nothing
 * else can read them. Without SUPABASE_URL the server runs as before: files
 * in data/, no accounts (local development and tests).
 */

export const supabaseUrl = (process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
const secretKey = process.env.SUPABASE_SECRET_KEY ?? "";

export const dbEnabled = (): boolean => !process.env.VITEST && !!supabaseUrl && !!secretKey;

let client: SupabaseClient | null = null;

export const db = (): SupabaseClient => {
  if (!dbEnabled()) throw new Error("The database is not configured (SUPABASE_URL / SUPABASE_SECRET_KEY).");
  client ??= createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return client;
};

/** Throw on a Supabase error, return the data. */
export const must = <T>(result: { data: T; error: { message: string } | null }, what: string): T => {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data;
};
